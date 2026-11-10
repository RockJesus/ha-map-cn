/* ---- CnTileEngine：轻量 XYZ 瓦片地图引擎（投影/平移/缩放/标记/聚合/轨迹） ---- */

import { CLUSTER_RADIUS_PX, CLUSTER_MAX_AVATAR } from "./shared.js";

class CnTileEngine extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.viewport = document.createElement("div");
    this.viewport.className = "cmc-viewport";
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "cmc-labels";
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "cmc-markers";
    // 轨迹层：SVG 覆盖，位于瓦片之上、标记之下
    this.pathLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.pathLayer.classList.add("cmc-paths");
    this.pathLayer.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:hidden";
    this.pathLayer.setAttribute("preserveAspectRatio", "none");
    this._pathGroups = new Map(); // entityId -> <path>
    this._hitGroup = null;        // 轨迹点悬停命中层
    this.onTrackHover = null;     // (info | null) => void，由卡片接管 tooltip
    this._paths = [];             // [{entityId, color, points}]
    // 聚合层：位于标记之上，承载多成员气泡
    this.clusterLayer = document.createElement("div");
    this.clusterLayer.className = "cmc-clusters";
    this.attribution = document.createElement("div");
    this.attribution.className = "cmc-attribution";
    this.viewport.style.position = "absolute";
    this.viewport.style.inset = "0";
    this.viewport.style.zIndex = "1";
    this.labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    this.markerLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
    this.clusterLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6";
    this.attribution.style.cssText =
      "position:absolute;right:4px;bottom:2px;font-size:10px;opacity:.6;pointer-events:none;color:var(--primary-text-color,#eee)";
    // 比例尺由卡片渲染在 shadow DOM，引擎通过 setScaleEl 拿到引用
    this.scaleEl = null;
    container.appendChild(this.viewport);
    container.appendChild(this.pathLayer);
    container.appendChild(this.labelLayer);
    container.appendChild(this.markerLayer);
    container.appendChild(this.clusterLayer);
    container.appendChild(this.attribution);

    this.zoom = 12;
    this.center = { lat: 39.9042, lng: 116.4074 }; // 默认北京
    this.tileSets = []; // {els: Map(key->img), url(fn), zIndex, opacity, maxZoom}
    this._tileSeq = 0;
    this._attachGestures();
  }

  /* ---- Web Mercator ---- */
  static project(lat, lng) {
    const clamp = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clamp * Math.PI) / 180;
    const s = Math.sin(rad);
    return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  static tileXY(lat, lng, z) {
    const p = CnTileEngine.project(lat, lng);
    const n = 2 ** z;
    return { x: p.x * n, y: p.y * n };
  }

  /* 屏幕坐标（clientX/clientY）→ 底图坐标系经纬度（拖动家图标用） */
  latLngAt(clientX, clientY) {
    const r = this.container.getBoundingClientRect();
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const wx = c.x + (clientX - r.left - w / 2) / (n * 256);
    const wy = c.y + (clientY - r.top - h / 2) / (n * 256);
    const lng = wx * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
    return { lat, lng };
  }

  setView(lat, lng, zoom) {
    this.center = { lat, lng };
    if (zoom != null) this.zoom = zoom;
    this.render();
  }

  /* 平滑飞行：官方点击标记 / 点击列表项时地图以动画平移+缩放到目标。
     线性插值 zoom（对数尺度视觉上更匀），经纬度按已走进度插值；
     期间用户任何手势立即接管（取消动画），避免"抢方向盘"的手感 */
  flyTo(lat, lng, zoom, duration = 550) {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      this.setView(lat, lng, zoom);
      return;
    }
    const from = { lat: this.center.lat, lng: this.center.lng, z: this.zoom };
    const toZ = Math.max(3, Math.min(18, zoom ?? this.zoom));
    // 视野里已经能看到目标时不缩放，只平移（官方 #54774 的"聚焦飞行语义"）
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = CnTileEngine.tileXY(from.lat, from.lng, from.z);
    const p = CnTileEngine.project(lat, lng);
    const n = 2 ** from.z;
    const px = (p.x - c.x) * n * 256 + w / 2;
    const py = (p.y - c.y) * n * 256 + h / 2;
    const targetZ = (px > 40 && px < w - 40 && py > 60 && py < h - 40) ? from.z : toZ;
    if (targetZ === from.z && Math.hypot(px - w / 2, py - h / 2) < 2) return; // 已居中，不动画
    const t0 = performance.now();
    this._fly?.cancel?.();
    let raf = 0;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (2 - 2 * t)); // easeInOutQuad
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = ease(k);
      this.center = { lat: from.lat + (lat - from.lat) * e, lng: from.lng + (lng - from.lng) * e };
      this.zoom = Math.round((from.z + (targetZ - from.z) * e) * 100) / 100; // 小数 zoom，render 支持
      this.render();
      if (k < 1 && !this._fly?.cancelled) raf = requestAnimationFrame(step);
      else this._fly = null;
    };
    this._fly = { cancelled: false, cancel: () => { this._fly.cancelled = true; cancelAnimationFrame(raf); } };
    raf = requestAnimationFrame(step);
  }

  addTileSet({ url, maxZoom = 18, zIndex = 1, opacity = 1, attribution = "", nofilter = false }) {
    const ts = { url, maxZoom, zIndex, opacity, els: new Map(), id: ++this._tileSeq };
    const layer = document.createElement("div");
    // nofilter：卫星影像 / 路况叠加不参与暗色反色，否则颜色会失真
    layer.className = nofilter ? "cmc-layer cmc-nofilter" : "cmc-layer";
    layer.style.cssText = `position:absolute;inset:0;z-index:${zIndex};opacity:${opacity}`;
    ts.layer = layer;
    this.viewport.appendChild(layer);
    this.tileSets.push(ts);
    this.attribution.innerHTML = attribution;
    return ts;
  }

  removeTileSets() {
    this.tileSets.forEach((t) => t.layer.remove());
    this.tileSets = [];
  }

  /* 叠加层（如实时路况）：独立于底图，移除时不影响底图 */
  setOverlay(id, spec) {
    this._overlays = this._overlays || new Map();
    const old = this._overlays.get(id);
    if (old) {
      old.tileSets.forEach((t) => t.layer.remove());
      this.tileSets = this.tileSets.filter((t) => !old.tileSets.includes(t));
      old.tileSets.forEach((t) => { t.els.forEach((i) => i.remove()); });
      this._overlays.delete(id);
    }
    if (!spec) return;
    const sets = spec.layers.map((l, i) => {
      const ts = this.addTileSet({
        url: l.template,
        maxZoom: spec.maxZoom || 18,
        opacity: l.opacity ?? 1,
        zIndex: 20 + i,
        nofilter: true,
      });
      return ts;
    });
    this._overlays.set(id, { tileSets: sets });
    this.render();
  }

  render() {
    // 尺寸还没量出来时用兜底值会让比例尺/瓦片算错，等一帧再来
    if (!this.container.clientWidth || !this.container.clientHeight) this._scheduleRenderRetry();
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);

    this.tileSets.forEach((ts) => {
      // flyTo 会产生小数 zoom：瓦片只能取整数级放大显示，标记/轨迹仍用精确值
      const z = Math.min(Math.floor(this.zoom), ts.maxZoom);
      const scale = 2 ** (this.zoom - z);   // 缩放级差：z 级瓦片放到 zoom 级要放大几倍
      const n = 2 ** z;
      // 当前视口在 z 级瓦片坐标系里的浮点范围（c 是 zoom 级，除回去）
      const cz = 2 ** (this.zoom - z);
      const cxz = c.x / cz, cyz = c.y / cz;
      const half = (Math.max(w, h) / 256) * (1 / scale) / 2 + 2;
      const tx0 = Math.floor(cxz - half);
      const tx1 = Math.ceil(cxz + half);
      const ty0 = Math.floor(cyz - half);
      const ty1 = Math.ceil(cyz + half);
      const keep = new Set();

      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (ty < 0 || ty >= n) continue;
          const wx = ((tx % n) + n) % n;
          const key = `${z}/${wx}/${ty}`;
          keep.add(key);
          let img = ts.els.get(key);
          if (!img) {
            img = document.createElement("img");
            img.className = "cmc-tile";
            img.loading = "eager";
            img.style.cssText =
              "position:absolute;width:256px;height:256px;user-select:none;-webkit-user-drag:none;image-rendering:auto";
            img.src = ts.url(wx, ty, z);
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { img.style.visibility = "hidden"; };
            ts.els.set(key, img);
            ts.layer.appendChild(img);
          }
          img.style.visibility = "visible";
          // 该瓦片左上角在 zoom 级像素坐标系中的位置，减去视口中心后居中
          const px = (tx - cxz) * 256 * scale + w / 2;
          const py = (ty - cyz) * 256 * scale + h / 2;
          img.style.left = `${px}px`;
          img.style.top = `${py}px`;
          const size = 256 * scale;
          img.style.width = `${size}px`;
          img.style.height = `${size}px`;
        }
      }
      ts.els.forEach((img, key) => {
        if (!keep.has(key)) { img.remove(); ts.els.delete(key); }
      });
    });

    this._layoutMarkers(w, h);
    this._layoutPaths(w, h);
    this._layoutCircles();
    this._updateScale(w);
  }

  /* 容器还没有尺寸时（0×0，常见于刚挂载/切视图），等下一帧再画 */
  _scheduleRenderRetry() {
    if (this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this.container.isConnected) return;
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) this.render();
    }, 120);
  }

  /* 比例尺：取一个整齐的距离，换算成屏幕像素宽度 */
  _updateScale(w) {
    if (!this.scaleEl) return;
    const lat = this.center.lat;
    const mPerPx =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** this.zoom;
    const targetPx = Math.min(120, w * 0.28);
    const rawM = mPerPx * targetPx;
    const pow = 10 ** Math.floor(Math.log10(rawM));
    const norm = rawM / pow;
    const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    const meters = nice * pow;
    const px = meters / mPerPx;
    this.scaleEl.style.width = `${Math.round(px)}px`;
    this.scaleEl.textContent =
      meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  }

  /* ---- 标记 ---- */
  setMarkers(markers, opts) {
    // markers: [{lat,lng,html,label,icon,sub,entityId,picture,color,home,clusterable,offline,selected}]
    this._markers = markers;
    // 首次调用时 _markerEls 还没建过，不能直接 forEach
    (this._markerEls || []).forEach((el) => el.classList.remove("is-selected"));
    this._selectedEntity = null;
    this._clusterOn = !!opts?.cluster;
    this.markerLayer.innerHTML = "";
    this.labelLayer.innerHTML = "";
    this._markerEls = markers.map((m) => {
      const el = document.createElement("div");
      el.className = "cmc-marker";
      el.style.cssText =
        "position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;text-align:center";
      // 用 DOM 构建，避免 entity_picture 里的引号把 innerHTML 拼断
      if (m.home) {
        const hm = document.createElement("div");
        hm.className = "cmc-home";
        const hic = document.createElement("ha-icon");
        hic.setAttribute("icon", m.icon || "mdi:home");
        hm.appendChild(hic);
        el.appendChild(hm);
        // 区域也要名字（官方 zone 标记带区域名），否则一排图标分不清是家还是公司
        if (m.label) {
          const lb = document.createElement("div");
          lb.className = "cmc-label";
          lb.textContent = m.label;
          el.appendChild(lb);
        }
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          // 拖动结束后浏览器仍会补一次 click，用标记位吞掉，别误开详情
          if (el.dataset.dragged === "1" || Date.now() < (this._suppressClickUntil || 0)) {
            el.dataset.dragged = "";
            return;
          }
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
        this._attachMarkerDrag(el, m);
        this.markerLayer.appendChild(el);
        return el;
      }
      if (m.picture) {
        const img = document.createElement("img");
        img.src = m.picture;
        img.referrerPolicy = "no-referrer";
        img.alt = "";
        el.appendChild(img);
      } else {
        const fb = document.createElement("div");
        fb.className = "cmc-fallback";
        if (m.color) fb.style.background = m.color;
        const ic = document.createElement("ha-icon");
        ic.setAttribute("icon", m.icon || "mdi:map-marker");
        fb.appendChild(ic);
        el.appendChild(fb);
      }
      if (m.label) {
        const lb = document.createElement("div");
        lb.className = "cmc-label";
        lb.textContent = m.label;
        // 灰显语义：实体失联（unavailable / unknown）时整枚标记降透明度
        if (m.offline) {
          el.classList.add("is-offline");
          lb.style.opacity = ".55";
          el.title = `${m.label}（离线）`;
        }
        el.appendChild(lb);
        // 状态行：官方 hui-map-marker 在名称下方给一行短状态（在家 / 5 分钟前 / 45 km/h）
        if (m.sub) {
          const sb = document.createElement("div");
          sb.className = "cmc-label cmc-label-sub";
          sb.textContent = m.sub;
          el.appendChild(sb);
        }
      }
      if (m.entityId) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
      }
      this.markerLayer.appendChild(el);
      return el;
    });
    // 选中态在 setMarkers 重建 DOM 后要补回来（_update 每次都重建）
    if (this._selectedEntity) {
      const idx = this._markers.findIndex((m) => m.entityId === this._selectedEntity);
      if (idx >= 0) this._markerEls[idx]?.classList.add("is-selected");
      else this._selectedEntity = null;
    }
    this._layoutMarkers();
  }

  /* 选中 / 取消选中实体：官方聚焦语义，标记加光环 */
  setSelected(entityId) {
    this._selectedEntity = entityId || null;
    // 可能在 setMarkers 之前被调用（如重建后恢复选中态），两个数组都要兜底
    (this._markerEls || []).forEach((el, i) => {
      el.classList.toggle("is-selected", !!entityId && this._markers?.[i]?.entityId === entityId);
    });
  }

  /* ---- 轨迹 ---- */
  setPaths(paths) {
    // paths: [{ entityId, color, points:[{lat,lng}] }]（坐标为最终投影所用坐标系）
    this._paths = paths || [];
    const keep = new Set();
    this._paths.forEach((p) => {
      let el = this._pathGroups.get(p.entityId);
      if (!el) {
        el = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el.setAttribute("fill", "none");
        el.setAttribute("stroke-linecap", "round");
        el.setAttribute("stroke-linejoin", "round");
        el.setAttribute("vector-effect", "non-scaling-stroke");
        this.pathLayer.appendChild(el);
        this._pathGroups.set(p.entityId, el);
      }
      el.setAttribute("stroke", p.color);
      el.setAttribute("stroke-width", String(p.width || 3));
      el.setAttribute("opacity", String(p.opacity ?? 0.85));
      if (p.dashed) el.setAttribute("stroke-dasharray", "6 5");
      else el.removeAttribute("stroke-dasharray");
      keep.add(p.entityId);
    });
    this._pathGroups.forEach((el, id) => {
      if (!keep.has(id)) { el.remove(); this._pathGroups.delete(id); }
    });
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    this._layoutPaths(w, h);
  }

  /* ---- 精度圈：官方按 gps_accuracy 画的半透明圆（WGS84 半径，米） ---- */
  setAccuracyCircles(circles) {
    // circles: [{entityId, lat, lng, radius(m), color}]
    this._accCircles = circles || [];
    this._layoutCircles();
  }

  _layoutCircles() {
    this._circleGroup?.remove();
    const list = this._accCircles;
    if (!list || !list.length) return;
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const group = this._circleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(group);
    for (const ci of list) {
      const q = CnTileEngine.project(ci.lat, ci.lng);
      const x = (q.x - c.x) * n * 256 + w / 2;
      const y = (q.y - c.y) * n * 256 + h / 2;
      // 米 → 像素：当前纬度下 1 像素的米数
      const mPerPx = (156543.03392 * Math.cos((ci.lat * Math.PI) / 180)) / n;
      const r = ci.radius / mPerPx;
      const drawCircle = r >= 2;
      if (drawCircle) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("cx", x.toFixed(1));
        el.setAttribute("cy", y.toFixed(1));
        el.setAttribute("r", r.toFixed(1));
        el.setAttribute("fill", ci.color || "#03a9f4");
        el.setAttribute("fill-opacity", String(ci.fillOpacity ?? 0.10));
        el.setAttribute("stroke", ci.color || "#03a9f4");
        el.setAttribute("stroke-opacity", String(ci.strokeOpacity ?? 0.30));
        el.setAttribute("stroke-width", String(ci.strokeWidth ?? 1.5));
        if (ci.dashed) el.setAttribute("stroke-dasharray", "5 4");
        group.appendChild(el);
      } else {
        // 半径太小画不清时仍保留一个隐形圆，避免 ci 为 null
        var el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("cx", x.toFixed(1));
        el.setAttribute("cy", y.toFixed(1));
        el.setAttribute("r", "0");
        group.appendChild(el);
      }
      if (ci.handle) {
        // 手柄位置：有半径圈时贴在圈右缘；半径太小画不出圈时，固定在 home 图标右侧 22px 处，
        // 保证缩放到全国视图也能长按到它
        const hx = drawCircle ? x + r : x + 22;
        const hy = y;
        const hd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hd.setAttribute("cx", hx.toFixed(1));
        hd.setAttribute("cy", hy.toFixed(1));
        hd.setAttribute("r", "7");
        hd.setAttribute("fill", "#fff");
        hd.setAttribute("stroke", ci.color || "#03a9f4");
        hd.setAttribute("stroke-width", "2");
        hd.setAttribute("style", "cursor:ew-resize;pointer-events:all");
        hd.setAttribute("class", "cmc-radius-handle");
        group.appendChild(hd);
        // 隐形大点击热区（28px），手机好按
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", hx.toFixed(1));
        hit.setAttribute("cy", hy.toFixed(1));
        hit.setAttribute("r", "18");
        hit.setAttribute("fill", "rgba(0,0,0,0)");
        hit.setAttribute("style", "pointer-events:all");
        group.appendChild(hit);
        this._attachRadiusHandle(hd, hit, ci, x, y, mPerPx);
      }
    }
  }

  clearPaths() {
    this._pathGroups.forEach((el) => el.remove());
    this._pathGroups.clear();
    this._paths = [];
  }

  _layoutPaths(w, h) {
    if (!this._paths.length) {
      this._arrowGroup?.remove();
      this._hitGroup?.remove();
      this._hitGroup = null;
      return;
    }
    const c = CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    // 大范围时不划线而是靠 SVG 裁剪；只有极端遥远（跨半球）才断开避免坐标溢出
    const margin = 4000;
    // 方向箭头（已知限制 #3 的补齐）：沿轨迹每隔 ~90px 放一个小三角，随平移缩放重算
    this._arrowGroup?.remove();
    const arrowGroup = this._arrowGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(arrowGroup);
    this._hitGroup?.remove();
    this._hitGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(this._hitGroup);
    const SPACING = 90, ARROW = 7; // 箭头半边长 px（6px 以下在高分屏上几乎看不见）
    this._paths.forEach((p) => {
      const el = this._pathGroups.get(p.entityId);
      if (!el) return;
      let d = "";
      let drawing = false;
      const screen = []; // [{x,y}] 供箭头取点
      for (const pt of p.points) {
        const q = CnTileEngine.project(pt.lat, pt.lng);
        const x = (q.x - c.x) * n * 256 + w / 2;
        const y = (q.y - c.y) * n * 256 + h / 2;
        // 超出视口太多时断线，避免坐标溢出画出跨屏长线
        if (x < -margin || x > w + margin || y < -margin || y > h + margin) {
          drawing = false;
          screen.length = 0;
          continue;
        }
        screen.push({ x, y, t: pt.t });
        d += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        drawing = true;
      }
      el.setAttribute("d", d);
      // 轨迹点悬停：抽稀成屏幕距离 ≥14px 的透明命中圆（几百个点各建一个元素会拖慢渲染）
      if (screen.some((q) => q.t != null)) {
        let lx = -1e9, ly = -1e9, made = 0;
        for (const q of screen) {
          if (q.t == null) continue;
          if (Math.hypot(q.x - lx, q.y - ly) < 14) continue;
          if (made >= 80) break;
          lx = q.x; ly = q.y; made++;
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", q.x.toFixed(1));
          dot.setAttribute("cy", q.y.toFixed(1));
          dot.setAttribute("r", "7");
          dot.setAttribute("fill", "transparent");
          dot.setAttribute("style", "pointer-events:all");
          const when = q.t;
          dot.addEventListener("mouseenter", (e) =>
            this.onTrackHover?.({ x: e.clientX, y: e.clientY, t: when, entityId: p.entityId, color: p.color }));
          dot.addEventListener("mouseleave", () => this.onTrackHover?.(null));
          this._hitGroup.appendChild(dot);
        }
      }
      // 沿折线按累计弧长取点放箭头；点太少或全在屏外则跳过
      if (screen.length < 2) return;
      const segs = [];
      let total = 0;
      for (let i = 1; i < screen.length; i++) {
        const len = Math.hypot(screen[i].x - screen[i-1].x, screen[i].y - screen[i-1].y);
        if (len > 0.5) { segs.push({ a: screen[i-1], b: screen[i], len }); total += len; }
      }
      if (total < SPACING) return;
      let placed = 0;
      for (const _seg of segs) {
        while (placed + SPACING / 2 < total) {
          const target = placed + SPACING / 2;
          // 找到 target 落在的线段
          let acc = 0, seg = null, t = 0;
          for (const sg of segs) {
            if (acc + sg.len >= target) { seg = sg; t = (target - acc) / sg.len; break; }
            acc += sg.len;
          }
          if (!seg) break;
          const x = seg.a.x + (seg.b.x - seg.a.x) * t;
          const y = seg.a.y + (seg.b.y - seg.a.y) * t;
          const ang = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180 / Math.PI;
          const tri = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          tri.setAttribute("points", `${ARROW},0 ${-ARROW * 0.7},${-ARROW * 0.8} ${-ARROW * 0.7},${ARROW * 0.8}`);
          tri.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
          tri.setAttribute("fill", p.color);
          // 描一圈底图同色的边，避免箭头和同色轨迹线糊在一起
          tri.setAttribute("stroke", "rgba(255,255,255,.85)");
          tri.setAttribute("stroke-width", "1");
          tri.setAttribute("opacity", String(Math.min(1, (p.opacity ?? 0.85) + 0.1)));
          arrowGroup.appendChild(tri);
          placed += SPACING;
          if (placed >= total) break;
        }
        break; // 只遍历一次，placed 累计到 total 即止
      }
    });
  }

  _layoutMarkers(w, h) {
    if (!this._markers || !this._markerEls) return;
    w = w || this.container.clientWidth || 400;
    h = h || this.container.clientHeight || 300;
    this._vw = w; this._vh = h;
    const c = CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const screen = [];
    this._markers.forEach((m, i) => {
      const p = CnTileEngine.project(m.lat, m.lng);
      const px = (p.x - c.x) * n * 256 + w / 2;
      const py = (p.y - c.y) * n * 256 + h / 2;
      const el = this._markerEls[i];
      const offscreen = px < -60 || px > w + 60 || py < -80 || py > h + 60;
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.display = offscreen ? "none" : "";
      el.style.visibility = "";
      screen.push({ marker: m, el, x: px, y: py, offscreen });
    });
    this._applyClusters(screen);
  }

  /* 贪心聚类：屏幕像素距离 <= CLUSTER_RADIUS_PX 的标记归为一组，单成员组不聚合 */
  _applyClusters(screen) {
    this.clusterLayer.innerHTML = "";
    if (!this._clusterOn) return;

    const groups = [];
    for (const entry of screen) {
      if (entry.offscreen || !entry.marker.clusterable) continue;
      let joined = false;
      for (const g of groups) {
        const dx = g.x - entry.x;
        const dy = g.y - entry.y;
        if (Math.hypot(dx, dy) <= CLUSTER_RADIUS_PX) {
          g.members.push(entry);
          const k = g.members.length;
          g.x = (g.x * (k - 1) + entry.x) / k;
          g.y = (g.y * (k - 1) + entry.y) / k;
          joined = true;
          break;
        }
      }
      if (!joined) groups.push({ members: [entry], x: entry.x, y: entry.y });
    }

    this._clusters = [];
    for (const g of groups) {
      if (g.members.length < 2) continue;
      // 质心可能被拽出视口（成员分布很散时），那就保持原样不聚合
      if (g.x < 0 || g.x > this._vw || g.y < 0 || g.y > this._vh) continue;
      g.members.forEach((m) => (m.el.style.visibility = "hidden"));
      const bubble = this._createClusterEl(g);
      bubble.style.left = `${g.x}px`;
      bubble.style.top = `${g.y}px`;
      this.clusterLayer.appendChild(bubble);
      this._clusters.push({ x: g.x, y: g.y, members: g.members.map((m) => m.marker) });
    }
  }

  /* 区域图标拖动（仅 zone.home）：必须长按 350ms 才进入可拖状态，防止误触。
     拖动期间只更新内存坐标，松手由卡片落盘 */
  _attachMarkerDrag(el, m) {
    if (!m.draggable) return;
    el.style.cursor = "grab";
    const LONG_PRESS = 350;
    let armTimer = null;
    let armed = false;
    let startPt = { x: 0, y: 0 };
    const clearArm = () => {
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      armed = false;
      el.classList.remove("cmc-armed");
    };
    const move = (e) => {
      // arm 之前：手指稍微一动就取消长按（把这一次触摸当成普通点按，不吞地图 pan）
      if (!armed) {
        if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 8) clearArm();
        return;
      }
      if (!this._dragMarker) return;
      const ll = this.latLngAt(e.clientX, e.clientY);
      if (!ll) return;
      m.lat = ll.lat; m.lng = ll.lng;
      if (el.isConnected) {
        const r = this.container.getBoundingClientRect();
        el.style.left = `${(e.clientX - r.left).toFixed(1)}px`;
        el.style.top = `${(e.clientY - r.top).toFixed(1)}px`;
      }
      if (!this._dragMoved && Math.hypot(e.clientX - this._dragStart.x, e.clientY - this._dragStart.y) > 4) {
        this._dragMoved = true;
        el.dataset.dragged = "1";
      }
      this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, lat: ll.lat, lng: ll.lng, phase: "move" } }));
    };
    const end = (e) => {
      clearArm();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this._suspendedPointers) this._suspendedPointers.delete(e?.pointerId);
      try { this.container.releasePointerCapture(e?.pointerId); } catch {}
      if (!this._dragMarker) return;
      this._dragMarker = null;
      el.style.cursor = "grab";
      // 松手后卡片会 _update() 重建标记，浏览器补发的 click 可能落在新元素上，
      // 用一个短时间窗统一吞掉，避免拖动后误开详情
      if (this._dragMoved) this._suppressClickUntil = Date.now() + 400;
      this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, lat: m.lat, lng: m.lng, phase: "end" } }));
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // 不立即 stopPropagation/preventDefault：arm 之前让地图正常响应 pan/click
      armed = false;
      this._dragMoved = false;
      startPt = { x: e.clientX, y: e.clientY };
      this._fly?.cancel?.(); this._fly = null;
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      armTimer = setTimeout(() => {
        armed = true;
        this._dragMarker = m.entityId;
        this._dragMoved = false;
        this._dragStart = { x: startPt.x, y: startPt.y };
        el.style.cursor = "grabbing";
        el.classList.add("cmc-armed");
        // 告诉地图手势：这根手指不再触发 pan/pinch，并把 pointer capture 从容器转到标记上
        if (this._suspendedPointers) this._suspendedPointers.add(e.pointerId);
        try { this.container.releasePointerCapture(e.pointerId); } catch {}
        try { el.setPointerCapture(e.pointerId); } catch {}
        this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, phase: "start" } }));
      }, LONG_PRESS);
    });
  }

  /* 半径手柄拖动：必须长按 350ms 才进入可拖状态，防止误触。
     跟着指针到圆心的距离算米数，实时改圆，松手由卡片落盘 */
  _attachRadiusHandle(handle, hitEl, ci, cx, cy, mPerPx0) {
    const LONG_PRESS = 350;
    let active = false;
    let armed = false;
    let armTimer = null;
    let startPt = { x: 0, y: 0 };
    const clearArm = () => {
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      armed = false;
      handle.classList.remove("cmc-armed");
    };
    const move = (e) => {
      if (!armed) {
        if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 8) clearArm();
        return;
      }
      if (!active) return;
      const r = this.container.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const mPerPx = mPerPx0 || (156543.03392 * Math.cos((ci.lat * Math.PI) / 180)) / 2 ** this.zoom;
      const meters = Math.max(20, Math.round(Math.hypot(px - cx, py - cy) * mPerPx));
      ci.radius = meters;
      // 同步更新可见手柄位置（贴在新半径边缘）
      handle.setAttribute("cx", (cx + meters / mPerPx).toFixed(1));
      hitEl.setAttribute("cx", (cx + meters / mPerPx).toFixed(1));
      this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: meters, phase: "move" } }));
    };
    const end = (e) => {
      clearArm();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this._suspendedPointers) this._suspendedPointers.delete(e?.pointerId);
      try { this.container.releasePointerCapture(e?.pointerId); } catch {}
      if (!active) return;
      active = false;
      this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: ci.radius, phase: "end" } }));
    };
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      armed = false;
      active = false;
      startPt = { x: e.clientX, y: e.clientY };
      this._fly?.cancel?.(); this._fly = null;
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      armTimer = setTimeout(() => {
        armed = true;
        active = true;
        handle.classList.add("cmc-armed");
        if (this._suspendedPointers) this._suspendedPointers.add(e.pointerId);
        try { this.container.releasePointerCapture(e.pointerId); } catch {}
        try { hitEl.setPointerCapture(e.pointerId); } catch {}
        this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: ci.radius, phase: "start" } }));
      }, LONG_PRESS);
    };
    handle.addEventListener("pointerdown", onDown);
    hitEl.addEventListener("pointerdown", onDown);
  }

  _createClusterEl(g) {
    const el = document.createElement("div");
    el.className = "cmc-cluster";
    el.style.cssText =
      "position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;display:flex;align-items:center";
    const shown = g.members.slice(0, CLUSTER_MAX_AVATAR);
    // 全是"没有位置"的实体（比如同一个家里但没坐标的设备）：直接显示数量，别画一堆空头像
    const useCount = g.members.every((m) => !m.marker.picture && !(m.marker.short || "").trim());
    if (useCount) {
      const c0 = document.createElement("div");
      c0.className = "cmc-cluster-count";
      c0.style.minWidth = "36px"; c0.style.height = "36px"; c0.style.borderRadius = "18px";
      c0.style.fontSize = "13px";
      c0.textContent = String(g.members.length);
      el.appendChild(c0);
    } else {
      shown.forEach((m, i) => {
        const a = document.createElement("div");
        a.className = "cmc-cluster-avatar";
        a.style.borderColor = m.marker.color || "#58a6f0";
        if (i) a.style.marginLeft = "-8px";
        const pic = m.marker.picture;
        if (pic) {
          const img = document.createElement("img");
          img.src = pic;
          img.referrerPolicy = "no-referrer";
          img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover";
          a.appendChild(img);
        } else {
          a.textContent = (m.marker.short || "").slice(0, 1) || "•";
        }
        el.appendChild(a);
      });
      const extra = g.members.length - shown.length;
      if (extra > 0) {
        const c = document.createElement("div");
        c.className = "cmc-cluster-count";
        c.style.marginLeft = "-6px";
        c.textContent = `+${extra}`;
        el.appendChild(c);
      }
    }
    el.title = g.members.map((m) => m.marker.short).join("、");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      // 点聚合气泡：放大两级把成员拆开（够大时直接给个菜单感的提示）
      this.dispatchEvent(
        new CustomEvent("cluster-click", {
          detail: { entityIds: g.members.map((m) => m.marker.entityId).filter(Boolean), count: g.members.length },
        })
      );
      this._userMoved = true;
      this.setZoom(Math.min(this.zoom + 2, 17), { anchor: { x: g.x, y: g.y } });
    });
    return el;
  }

  /* ---- 交互 ---- */
  _attachGestures() {
    const pts = new Map(); let pinchD0 = 0, pinchZ0 = 0, pinchMoved = false;
    const el = this.container;
    el.style.touchAction = "none";
    // 当 home 标记 / 半径手柄长按 arm 后，把对应 pointerId 加入 _suspendedPointers，
    // 地图 pan/pinch 要忽略它——否则手指在 arm 后继续滑，地图也跟着 pan，
    // 看起来就是「home 不跟手、地图乱跑」。
    this._suspendedPointers = this._suspendedPointers || new Set();
    // 点空白处（没点在标记/聚合上）取消选中：官方语义
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.classList?.contains("cmc-viewport") || e.target.tagName === "IMG") {
        if (this._selectedEntity) {
          this.setSelected(null);
          this.dispatchEvent(new CustomEvent("selection-cleared"));
        }
      }
    });

    const panBy = (dx, dy) => {
      this._userMoved = true;
      const c = CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);
      const n = 2 ** this.zoom;
      const lng = ((c.x * 256 - dx) / 256 / n) * 360 - 180;
      const my = (c.y * 256 - dy) / 256 / n;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
      this.setView(lat, lng);
    };

    // 缩放锚点：把屏幕坐标换算成容器内坐标（setZoom 的 anchor 语义）
    const anchorAt = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    el.addEventListener("pointerdown", (e) => {
      // 用户手势立即接管，取消进行中的飞行动画（官方"抢方向盘"行为）
      this._fly?.cancel?.(); this._fly = null;
      if (this._suspendedPointers.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
        pinchZ0 = this.zoom; pinchMoved = false;
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (this._suspendedPointers.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        // 双指：以两指中点为锚按距离比例平滑缩放（不再整级跳变）
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD0 > 0 && d > 0) {
          if (Math.abs(d - pinchD0) > 6) pinchMoved = true;
          this.setZoom(Math.max(2, Math.min(19, pinchZ0 + Math.log2(d / pinchD0))), {
            anchor: anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2),
          });
        }
        return; // 捏合时不触发单指平移
      }
      // 单指平移：地图跟随手势（和 Leaflet / 高德 / 官方 ha-map 一致）
      panBy(e.clientX - p.px, e.clientY - p.py);
      p.px = e.clientX; p.py = e.clientY;
    });
    const endPointer = (e) => {
      if (pinchMoved) this._suppressClickUntil = Date.now() + 400; // 捏合后别误触选中
      pts.delete(e.pointerId);
      this._suspendedPointers.delete(e.pointerId);
      if (pts.size < 2) pinchD0 = 0;
      if (pts.size === 1) { const q = [...pts.values()][0]; q.px = q.x; q.py = q.y; }
    };
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      // 以光标为锚：光标下的地物缩放前后不动（官方 ha-map / Leaflet 一致）
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1), { anchor: anchorAt(e.clientX, e.clientY) });
    }, { passive: false });
    el.addEventListener("dblclick", (e) => this.setZoom(this.zoom + 1, { anchor: anchorAt(e.clientX, e.clientY) }));

    // 键盘快捷键（对齐官方 ha-map）：+/- 缩放、方向键平移、Esc 清除选中
    el.tabIndex = 0;
    el.style.outline = "none";
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 4; // Shift+方向键 = 大步平移
      // 方向键语义 = 视野朝该方向移动（按 → 看东边，内容往左滑），与拖拽/官方一致
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = step;
      else if (e.key === "ArrowRight") dx = -step;
      else if (e.key === "ArrowUp") dy = step;
      else if (e.key === "ArrowDown") dy = -step;
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); this.setZoom(this.zoom + 1); return; }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); this.setZoom(this.zoom - 1); return; }
      else if (e.key === "Escape") {
        if (this._selectedEntity) {
          this.setSelected(null);
          this.dispatchEvent(new CustomEvent("selection-cleared"));
          e.preventDefault();
        }
        return;
      } else return;
      e.preventDefault();
      panBy(dx, dy);
    });
  }

  setZoom(z, opts) {
    this._userMoved = true;
    const next = Math.max(3, Math.min(18, z));
    const anchor = opts?.anchor;
    if (anchor) {
      // 以锚点（屏幕像素）为中心缩放：保持锚点下的地理坐标不动。
      // 归一化世界坐标：screenX = (worldX - centerX) * 2^z * 256 + w/2
      const w = this.container.clientWidth || 400;
      const h = this.container.clientHeight || 300;
      const c = CnTileEngine.project(this.center.lat, this.center.lng);
      const w0 = 2 ** this.zoom * 256;
      const w1 = 2 ** next * 256;
      const ax = anchor.x - w / 2;
      const ay = anchor.y - h / 2;
      const wx = c.x + ax / w0;   // 锚点正下方的地物（世界坐标）
      const wy = c.y + ay / w0;
      const ncx = wx - ax / w1;   // 缩放后把该地物放回锚点所在像素
      const ncy = wy - ay / w1;
      this.zoom = next;
      this.center = {
        lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * ncy))) * 180) / Math.PI,
        lng: ncx * 360 - 180,
      };
      this.render();
      return;
    }
    this.zoom = next;
    this.render();
  }

  fitBounds(points, padding = 40) {
    if (!points.length) return;
    // 支持不对称 padding：{top,right,bottom,left}（数值 px）。手机上底部抽屉盖地图，
    // 视野要把中心往上抬，避免 home 标记被抽屉挡住
    const pad = typeof padding === "object" ? padding : { top: padding, right: padding, bottom: padding, left: padding };
    const base = {
      top: pad.top ?? 40, right: pad.right ?? 40, bottom: pad.bottom ?? 40, left: pad.left ?? 40,
    };
    if (points.length === 1) { this.setView(points[0].lat, points[0].lng, 14); return; }
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach((p) => {
      const t = CnTileEngine.project(p.lat, p.lng);
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    });
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    let best = 3;
    for (let z = 18; z >= 3; z--) {
      const n = 2 ** z;
      if ((maxX - minX) * n * 256 < w - base.left - base.right &&
          (maxY - minY) * n * 256 < h - base.top - base.bottom) { best = z; break; }
    }
    // 多枚标记重合时"能装下"会一路解到最大层级，视觉上等于跳到一栋楼；
    // 按卡片宽度给个上限（宽卡片 16 级，手机窄卡片 15 级），簇内差异再靠聚合气泡表现。
    const fitCap = Math.max(3, Math.min(16, Math.round(w / 140) + 11));
    best = Math.min(best, fitCap);
    // 视野中心按不对称 padding 偏移：底部留得多时把地理中心往上抬
    const n = 2 ** best;
    const usedW = w - base.left - base.right;
    const usedH = h - base.top - base.bottom;
    const cxWorld = (minX + maxX) / 2 + (base.right - base.left) / 2 / n / 256;
    const cyWorld = (minY + maxY) / 2 + (base.bottom - base.top) / 2 / n / 256;
    void usedW; void usedH;
    this.setView(latFromY(cyWorld), lngFromX(cxWorld), best);

    function latFromY(y) { return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI; }
    function lngFromX(x) { return x * 360 - 180; }
  }
}


export { CnTileEngine };
