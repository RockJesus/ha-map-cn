/**
 * ha-cn-map-card v1.1.4 — 国内底图 HA 地图卡片（HACS 自定义卡片）
 *
 * 零依赖：内置轻量 XYZ 瓦片引擎（投影/平移/缩放/标记），不引 Leaflet。
 * 底图：amap（高德，免 Key，标记自动 GCJ-02 纠偏）| tianditu（需 Key，无偏移）
 *       | tianditu-satellite
 *
 * 最小配置：
 *   type: custom:ha-cn-map-card
 *   entities:
 *     - person.me
 */

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
    const cx = c.x * 256;
    const cy = c.y * 256;

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
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
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
      if (r < 2 || r > Math.max(w, h) * 3) continue; // 半径太小画不清、太大没意义
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
      for (const s of segs) {
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
    let dragging = false, lastX = 0, lastY = 0, pinchDist = 0;
    const el = this.container;
    el.style.touchAction = "none";
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

    el.addEventListener("pointerdown", (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      // 用户手势立即接管，取消进行中的飞行动画（官方"抢方向盘"行为）
      this._fly?.cancel?.(); this._fly = null;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      // 地图跟随手势：往右拖内容往右走（和 Leaflet / 高德 / 官方 ha-map 一致）
      panBy(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    });
    el.addEventListener("pointerup", () => (dragging = false));
    el.addEventListener("pointercancel", () => (dragging = false));
    // 缩放锚点：把屏幕坐标换算成容器内坐标（setZoom 的 anchor 语义）
    const anchorAt = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      // 以光标为锚：光标下的地物缩放前后不动（官方 ha-map / Leaflet 一致）
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1), { anchor: anchorAt(e.clientX, e.clientY) });
    }, { passive: false });
    el.addEventListener("dblclick", (e) => this.setZoom(this.zoom + 1, { anchor: anchorAt(e.clientX, e.clientY) }));
    el.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        // 双指缩放同理：以两指中点为锚，默认往哪边捏就往哪边放
        const anchor = anchorAt(
          (e.touches[0].clientX + e.touches[1].clientX) / 2,
          (e.touches[0].clientY + e.touches[1].clientY) / 2
        );
        if (pinchDist) this.setZoom(this.zoom + (d > pinchDist ? 1 : -1), { anchor });
        pinchDist = d;
      }
    }, { passive: true });
    el.addEventListener("touchend", () => (pinchDist = 0));

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
      if ((maxX - minX) * n * 256 < w - 2 * padding && (maxY - minY) * n * 256 < h - 2 * padding) { best = z; break; }
    }
    // 多枚标记重合时"能装下"会一路解到最大层级，视觉上等于跳到一栋楼；
    // 按卡片宽度给个上限（宽卡片 16 级，手机窄卡片 15 级），簇内差异再靠聚合气泡表现。
    const fitCap = Math.max(3, Math.min(16, Math.round(w / 140) + 11));
    best = Math.min(best, fitCap);
    this.setView(latFromY((minY + maxY) / 2), lngFromX((minX + maxX) / 2), best);

    function latFromY(y) { return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI; }
    function lngFromX(x) { return x * 360 - 180; }
  }
}

/* ---- GCJ-02 → WGS84（高德底图时把 WGS84 标记投到底图坐标系） ---- */
const GCJ = (() => {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  };
  const tLng = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  };
  return {
    // 返回 [gcjLat, gcjLng]：把 WGS84 坐标挪到高德瓦片上正确的显示位置
    outOfChina: (lat, lng) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271,
    wgs2gcj(lat, lng) {
      if (this.outOfChina(lat, lng)) return [lat, lng];
      let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
      const radLat = lat / 180 * Math.PI;
      let magic = Math.sin(radLat);
      magic = 1 - ee * magic * magic;
      const sqrt = Math.sqrt(magic);
      dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrt) * Math.PI);
      dLng = (dLng * 180) / (a / sqrt * Math.cos(radLat) * Math.PI);
      return [lat + dLat, lng + dLng];
    },
  };
})();

/* ---- 运行时设置持久化（浏览器本地，不改 /config/.storage 里的仪表盘 YAML） ---- */
const LS_PREFIX = "ha-cn-map-card:";
// 实体处于这些状态时视为"无有效位置/失联"，标记灰显
const OFFLINE_STATES = new Set(["unavailable", "unknown"]);
// 设置抽屉 / 快捷按钮可写回本地的键
const RUNTIME_KEYS = [
  "basemap",
  "theme_mode",
  "tianditu_key",
  "show_traffic",
  "hours_to_show",
  "show_zones",
  "show_zone_radius",
  "show_labels",
  "label_mode",
  "show_cluster",
  "show_status",
  "show_accuracy",
  "height",
];
// 同一张卡片在多个视图里会被实例化成多个实例；按「仪表盘路径 + 卡片顺序」生成稳定 id
function storageKey(config) {
  const v = config?.view_index ?? 0;
  const i = config?.card_index ?? 0;
  const path = (typeof window !== "undefined" && window.location?.pathname) || "/";
  return `${LS_PREFIX}${path}#v${v}c${i}`;
}
function loadRuntime(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}
function saveRuntime(key, opts) {
  try {
    window.localStorage.setItem(key, JSON.stringify(opts));
  } catch {
    /* 隐私模式 / 配额满：忽略 */
  }
}

const CLUSTER_RADIUS_PX = 60;  // 屏幕像素距离内合并
const CLUSTER_MAX_AVATAR = 3;  // 气泡里最多显示几个头像

/* ---- 布局模式（对齐官方 hui-map-card 的 layout 语义） ----
   official：仪表盘把我放在 panel 视图（或全屏）里 → 地图铺满、右下角抽屉面板
   compact ：sections / masonry / grid 里 → 固定高度
   full   ：卡片自己占满视口（fullscreen: true）                              */
const LAYOUT = { OFFICIAL: "official", COMPACT: "compact", FULL: "full" };
// 卡片能拿到的高度（px）；infinity 表示由祖先决定 */
const VIEWPORT_H = () => (typeof window !== "undefined" ? window.innerHeight || 800 : 800);

/* 官方 MDI 图标路径（16 进制），避免额外请求图标字体 */
const ICONS = {
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  minus: "M19,13H5V11H19V13Z",
  focus: "M10,20V14H4V10H10V4H14V10H20V14H14V20H10Z",
  cluster: "M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z",
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  traffic: "M20,5H4A2,2 0 0,0 2,7V17A2,2 0 0,0 4,19H20A2,2 0 0,0 22,17V7A2,2 0 0,0 20,5M7,15A2.5,2.5 0 0,1 4.5,12.5A2.5,2.5 0 0,1 7,10A2.5,2.5 0 0,1 9.5,12.5A2.5,2.5 0 0,1 7,15M17,15A2.5,2.5 0 0,1 14.5,12.5A2.5,2.5 0 0,1 17,10A2.5,2.5 0 0,1 19.5,12.5A2.5,2.5 0 0,1 17,15M13,13H11V11H13V13M13,10H11V8H13V10Z",
  chevronLeft: "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",
  history: "M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 1,1 13,19C11.07,19 9.36,18.16 8.19,16.85L6.77,18.27A9,9 0 1,0 13,3Z",
  fullscreen: "M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",
  fullscreenExit: "M5,16H8V19H10V16A2,2 0 0,0 8,14H5V16M16,16V19H14V16A2,2 0 0,1 16,14H19V16H16M10,5V8A2,2 0 0,1 8,10H5V8H8V5H10M14,5H16V8H19V10H16A2,2 0 0,1 14,8V5Z",
  people: "M16,13C15.71,13 15.38,13 15.03,13.05C16.19,13.89 17,15 17,16.5V19H23V16.5C23,14.17 18.33,13 16,13M8,13C5.67,13 1,14.17 1,16.5V19H15V16.5C15,14.17 10.33,13 8,13M8,11C9.66,11 11,9.66 11,8C11,6.34 9.66,5 8,5C6.34,5 5,6.34 5,8C5,9.66 6.34,11 8,11M16,11C17.66,11 19,9.66 19,8C19,6.34 17.66,5 16,5C14.34,5 13,6.34 13,8C13,9.66 14.34,11 16,11Z",
};

/* ---- 底图源 ---- */
const BASEMAPS = {
  amap: {
    name: "高德",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true, // 标记需 WGS84→GCJ02
    layers: [
      { template: (x, y, z) => `https://webrd0${(x % 4) + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}` },
    ],
  },
  "amap-satellite": {
    name: "高德卫星",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true,
    noFilter: true, // 卫星影像反色会变成"负片"，暗色模式也不套 filter
    layers: [
      { template: (x, y, z) => `https://webst0${(x % 4) + 1}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}` },
      { template: (x, y, z) => `https://webst0${(x % 4) + 1}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`, opacity: 0.9 },
    ],
  },
  tianditu: {
    name: "天地图",
    attribution: "© 国家天地图",
    maxZoom: 18,
    needsShift: false,
    requireKey: true,
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=vec_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cva_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
    ],
  },
  "tianditu-satellite": {
    name: "天地图卫星",
    attribution: "© 国家天地图",
    maxZoom: 18,
    needsShift: false,
    requireKey: true,
    noFilter: true,
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=img_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cia_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
    ],
  },
  traffic: {
    name: "实时路况",
    attribution: "© 高德路况",
    maxZoom: 18,
    needsShift: false,
    layers: [
      { template: (x, y, z) =>
          `https://tm.amap.com/trafficengine/mapabc/traffictile?v=1.0&t=1&x=${x}&y=${y}&z=${z}`,
        opacity: 0.9 },
    ],
  },
  osm: {
    name: "OpenStreetMap",
    attribution: "© OpenStreetMap",
    maxZoom: 19,
    needsShift: false,
    layers: [{ template: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` }],
  },
};

/* ---- HTML 转义（列表项直接拼字符串，实体名可能带特殊字符） ---- */
const escapeHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = (v) => escapeHtml(v);

/* ---- 卡片 ---- */
class HaCnMapCard extends HTMLElement {
  static getStubConfig() {
    return { show_all: true };
  }
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._preview = false;    // 官方 preview 属性：卡片选择器/编辑器预览态
    this._trackPoints = {};   // entityId -> [{lat,lng}]
    this._trackUnsub = null;  // history 订阅取消函数
    this._trackSig = "";      // 订阅参数签名，避免重复订阅
    this._hiddenIds = null;   // 实体注册表里 hidden_by 非空的实体集合；null = 尚未拉取
    this._registryTried = false; // 注册表只拉一次，失败（权限/旧版本 HA）不重试
    // 官方交互：首次点标记 = 聚焦飞行 + 选中；设 false 恢复"直接弹 more-info"
    this._focusOnMarkerClick = true;
    this._bleedUser = undefined; // 用户点全屏按钮的选择：true 铺满 / false 不铺满 / undefined 自动
    this._isBleed = false;
    // Esc 退出全屏（事件从 shadow 里冒泡上来，composed 事件才有）
    this.addEventListener("keydown", this._onKeyBleed = (e) => {
      if (e.key === "Escape" && this.classList.contains("cmc-bleed")) {
        this._bleedUser = false;
        this._applyBleed(false);
      }
    });
  }

  /* hui-card 在 panel 视图里会直接给卡片元素赋 layout="panel"（官方卡片同样读这个属性） */
  get layout() { return this._hLayout; }
  set layout(v) {
    const old = this._hLayout;
    this._hLayout = v;
    if (old !== v && this._config && this.isConnected) {
      Promise.resolve().then(() => this._syncLayout());
    }
  }
  get isPanel() { return this._hLayout === "panel"; }
  // hui-card 还会顺手写 element.isPanel；只读会抛错（它有 try/catch，抛了就把卡片换成错误卡），给个空 setter
  set isPanel(_v) {}

  /* 官方卡片 API：preview=true 表示这张卡正被渲染在卡片选择器/编辑器里。
     预览态不该真的去订阅历史轨迹（那是一次 WebSocket 请求），也不该铺满全屏 */
  get preview() { return this._preview; }
  set preview(v) {
    const on = !!v;
    if (on === this._preview) return;
    this._preview = on;
    if (on && this._engine) {
      if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
      this._trackSig = "";
      this._trackPoints = {};
    }
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("ha-cn-map-card: 配置无效");
    this._rawConfig = config;
    this._config = {
      basemap: "amap",            // amap | amap-satellite | tianditu | tianditu-satellite | osm
      tianditu_key: "",
      default_zoom: 12,
      hours_to_show: 0,          // >0 时绘制轨迹线
      track_width: 3,
      track_opacity: 0.85,
      show_traffic: false,       // 高德实时路况叠加
      show_all: false,
      show_zones: false,
      show_zone_radius: true,    // zone 半径圈（官方把半径当 zone 的核心属性）
      dedupe_trackers: true,     // person 已覆盖的 device_tracker 不再单独画点
      respect_hidden: true,      // 实体注册表里被用户隐藏（hidden_by）的实体不再上地图
      fit_zones: false,          // 自动适配视野时把区域半径圈也算进去
      show_labels: true,
      label_mode: "name",        // name | state | attribute | none（可在 entities 里逐实体覆盖）
      show_status: true,         // 标记下方状态行（在家 / 离线 / 速度 / 电量 / 相对时间）
      show_accuracy: true,       // GPS 精度圈（gps_accuracy，对齐官方）
      show_cluster: true,        // 标记聚合
      fit_entities: true,
      height: 360,
      aspect_ratio: "",          // 如 "16:9"，填了就忽略 height（官方 aspect_ratio 语义）
      entities: [],
      conditions: [],            // 条件显示：每条都满足才渲染，否则整卡隐藏（官方条件卡片语义）
      geo_location_sources: [],
      title: "",
      theme_mode: "auto",        // auto（跟随 HA 主题）| light | dark
      ...config,
    };
    // 本地保存的运行时设置（设置抽屉/快捷按钮改过的）优先于 YAML
    this._lsKey = storageKey(config);
    if (config.persist !== false) this._applyRuntime(loadRuntime(this._lsKey));

    if (BASEMAPS[this._config.basemap]?.requireKey && !this._config.tianditu_key) {
      console.warn("[ha-cn-map-card] 天地图需要 tianditu_key，已回退到高德");
      this._config.basemap = "amap";
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // 主题可能是 auto：hass.themes.darkMode 变了要立刻切（不必重建整张卡片）
    const dark = this._resolveDark();
    if (dark !== this._dark) {
      this._dark = dark;
      this.shadowRoot?.querySelector(".cmc-card")?.classList.toggle("is-dark", dark);
    }
    if (this._engine) this._update();
    // 用户在 HA 设置里隐藏的实体不该出现在地图上（官方 hui-map-card 同样查注册表）。
    // 注册表是一次异步请求，回来自动触发一次重绘
    this._ensureEntityRegistry();
  }

  /* 拉一次实体注册表，缓存 hidden_by 非空的实体集合。
     只在 show_all / geo_location_sources 自动收集时生效；
     用户显式写进 entities: 的实体永远照画——点名了就不替他做决定。
     HA 2023.4+ 才有 hidden_by；拿不到（权限/版本）就置空集合并永不重试 */
  _ensureEntityRegistry() {
    if (this._registryTried || this._preview) return;
    const conn = this._hass?.connection;
    if (!conn?.sendMessagePromise) return;
    this._registryTried = true;
    Promise.resolve()
      .then(() => conn.sendMessagePromise({ type: "config/entity_registry/list" }))
      .then((entries) => {
        this._hiddenIds = new Set(
          (entries || []).filter((e) => e?.hidden_by).map((e) => e.entity_id)
        );
        if (this._hiddenIds.size && this._config?.respect_hidden !== false && this._engine) this._update();
      })
      .catch(() => { this._hiddenIds = new Set(); });
  }

  /* 解析 "16:9" / "4/3" / "21x9" 这类宽高比；非法值返回 null */
  _parseAspect(v) {
    if (!v || typeof v !== "string") return null;
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const w = Number(m[1]), h = Number(m[2]);
    return w > 0 && h > 0 ? { w, h } : null;
  }

  /* 宽高比：卡片按比例撑高，全屏态忽略（铺满是第一优先级） */
  _applyAspect() {
    const card = this.shadowRoot?.querySelector(".cmc-card");
    if (!card || typeof this.style === "undefined") return;
    const r = this._isFull ? null : this._parseAspect(this._config?.aspect_ratio);
    card.classList.toggle("is-aspect", !!r);
    card.style.aspectRatio = r ? `${r.w} / ${r.h}` : "";
    this.style.height = this._isFull ? "" : r ? "auto" : `${this._config?.height || 360}px`;
  }

  /* 暗色判定：显式 theme_mode 优先，auto 跟随 HA 主题，再兜底系统偏好 */
  _resolveDark() {
    const mode = this._config?.theme_mode || "auto";
    if (mode === "dark") return true;
    if (mode === "light") return false;
    const t = this._hass?.themes?.darkMode;
    if (typeof t === "boolean") return t;
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  }

  /* 把 localStorage 里的运行时设置合并进当前配置（YAML 里的显式值仍可通过 persist:false 关闭） */
  _applyRuntime(opts) {
    if (!opts || typeof opts !== "object") return;
    const cfg = { ...this._config };
    RUNTIME_KEYS.forEach((k) => {
      if (opts[k] !== undefined) cfg[k] = opts[k];
    });
    this._config = cfg;
  }

  /* 把当前配置里"运行时可变"的键落盘，下次刷新/切视图仍生效 */
  _saveRuntime() {
    if (this._rawConfig?.persist === false) return;
    const out = {};
    RUNTIME_KEYS.forEach((k) => {
      // 注意：false / 0 都是有效状态，不能被当成"未设置"过滤掉
      if (this._config[k] !== undefined && this._config[k] !== "") out[k] = this._config[k];
    });
    saveRuntime(this._lsKey || storageKey(this._rawConfig), out);
  }

  /* 解析布局：官方 panel 视图 / sections 紧凑 / 自定义全屏 */
  _resolveLayout() {
    const cfg = this._config;
    // 用户显式指定 compact 时永远尊重（哪怕在 panel 视图里）
    if (cfg.layout === "compact" || cfg.fullscreen === false) return LAYOUT.COMPACT;
    if (cfg.fullscreen === true || cfg.layout === "full" || cfg.layout === "panel" || cfg.fill === true) return LAYOUT.FULL;
    // 关键：hui-card 在 panel 视图里会直接给卡片元素赋 layout="panel"（官方 hui-map-card 也读这个信号）。
    // 这比爬 DOM 祖先可靠得多——隔壁 shadow root 里的 hui-panel-view 用 parentElement 根本爬不到。
    if (this.layout === "panel" || this.isPanel === true) return LAYOUT.FULL;
    return this._autoLayout();
  }

  /* 祖先遍历：必须穿透 shadow root，否则 panel 视图里 parentElement 直接是 null
     （卡片挂在 hui-card 的 light DOM 里，再往上是 hui-panel-view 的 shadowRoot） */
  _ancestors(max = 10) {
    const out = [];
    let cur = this;
    let el = cur.parentElement;
    for (let i = 0; i < max && el; i++) {
      out.push(el);
      const root = el.getRootNode?.();
      if (root && root.host) {
        cur = root.host;          // 跨过 shadow 边界，继续从宿主往上爬
        el = cur.parentElement;
        // 宿主本身也算一层（它就是 hui-panel-view / hui-grid-section 之类）
        out.push(cur);
      } else {
        el = el.parentElement;
      }
    }
    return out;
  }

  /* 自动判定：往上看几层，找真正给我分配高度的那个祖先。
     HA 的嵌套关系不固定（panel 视图 shadowRoot > hui-card > 卡片；
     sections 视图 hui-grid-section shadowRoot > grid > 格子 > hui-card > 卡片），所以逐层试。 */
  _autoLayout() {
    if (typeof window === "undefined" || !this.isConnected) return LAYOUT.COMPACT;
    const viewH = window.innerHeight || document.documentElement.clientHeight || 800;
    const selfH = this.getBoundingClientRect().height;
    for (const el of this._ancestors(10)) {
      const tag = el.localName || "";
      const r = el.getBoundingClientRect();
      // sections 视图：卡片被困在固定高度的 grid 格子里，铺满没意义 → compact（想全屏请开 fill / 点全屏按钮）
      if (/^(hui-grid-section|hui-sections-view)$/.test(tag)) return LAYOUT.COMPACT;
      // 卡片直接挂在视图容器上 → 官方 panel 布局
      if (/^(hui-panel-view|hui-masonry-view|hui-grid-view)$/.test(tag)) {
        return r.height > viewH * 0.7 ? LAYOUT.FULL : LAYOUT.COMPACT;
      }
      // 过渡容器（hass-tabs-subpage / hui-view 等）：高度接近视口且明显高于我 → 可铺满
      if (r.height > viewH * 0.8 && r.height > selfH * 1.5) return LAYOUT.FULL;
    }
    return LAYOUT.COMPACT;
  }

  /* ---- 真·全屏（bleed）----
     为什么需要它：sections 视图的格子高度是 JS 定死的 410px 左右，panel 视图里
     hui-card 也可能不给卡片高度——这两种情况 height:100% 都不可能铺满。
     所以只要"该全屏但实际没占满"，就把宿主改成 position:fixed 直接跳出容器。 */
  _parentTooSmall() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const p = this.parentElement;
    if (!p) return true;
    const r = p.getBoundingClientRect();
    // 父容器高度不足以容纳整屏 → 说明它不会给我铺满的空间
    return r.height < vh * 0.85;
  }

  _wantBleed() {
    // 用户手动点过全屏按钮：以手动选择为准（哪怕当前布局判定为紧凑）
    if (this._bleedUser === true) return true;
    if (this._layout !== LAYOUT.FULL) return false;
    if (this._bleedUser === false) return false;
    // 显式 fill:true → 无条件铺满
    if (this._config?.fill === true) return true;
    return this._parentTooSmall();
  }

  _applyBleed(on, initial) {
    const has = this.classList.contains("cmc-bleed");
    if (on && !has) {
      // 清掉 compact 模式下写死的内联高度，否则会压过 :host(.cmc-bleed)
      this.style.height = "";
      this.classList.add("cmc-bleed");
    } else if (!on && has) {
      this.classList.remove("cmc-bleed");
      this.style.height = this._layout === LAYOUT.FULL ? "" : `${this._config?.height || 360}px`;
    }
    const btn = this.shadowRoot?.querySelector("[data-fs]");
    if (btn) {
      const icon = on ? ICONS.fullscreenExit : ICONS.fullscreen;
      btn.querySelector("path")?.setAttribute("d", icon);
      btn.setAttribute("aria-label", on ? "退出全屏" : "全屏");
      btn.setAttribute("title", on ? "退出全屏" : "全屏");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (!initial) {
      this._isBleed = on;
      // 尺寸变了，瓦片要重铺；等浏览器完成布局再算
      requestAnimationFrame(() => this._engine?.render());
    }
    this._isBleed = on;
  }

  /* 外部尺寸变化后自愈：该全屏却没铺满就自动升级成 fixed */
  _syncBleed() {
    if (this._layout !== LAYOUT.FULL) return;
    if (this._bleedUser !== undefined) return;
    const want = this._wantBleed();
    if (want !== this.classList.contains("cmc-bleed")) this._applyBleed(want);
  }

  _toggleBleed() {
    const on = !this.classList.contains("cmc-bleed");
    this._bleedUser = on;
    this._applyBleed(on);
  }

  _render() {
    // 重建会把引擎换掉：先记住旧视野，切底图/主题时不该把人踢回北京
    const prevView = this._engine
      ? {
          c: { ...this._engine.center },
          z: this._engine.zoom,
          moved: this._engine._userMoved,
          sel: this._engine._selectedEntity || null, // 重建后要恢复选中光环，否则详情页"选中却无光环"
        }
      : null;
    const cfg = this._config;
    const base = BASEMAPS[cfg.basemap] || BASEMAPS.amap;
    const layout = this._layout = this._resolveLayout();
    const isFull = layout === LAYOUT.FULL;
    // 官方在 panel 布局把缩放控件放右上、其它情况左上
    const zoomSide = isFull ? "right" : "left";
    // fill：sections 视图里也铺满（bleed 会接管实际铺满）
    const fill = cfg.fill === true;
    const ar = this._parseAspect(cfg.aspect_ratio);
    const h = isFull ? "100%" : ar ? "auto" : `${cfg.height || 360}px`;
    // 内联压过外部对宿主元素的 height:100% 拉伸（panel 视图会这样干）
    if (typeof this.style !== "undefined") this.style.height = isFull ? "" : h;
    this._isFull = isFull;
    this._zoomSide = zoomSide;

    const titleHtml = cfg.title
      ? `<div class="cmc-title">${cfg.title}</div>` : "";
    const overlayOpen = this._panelOpen === true;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          height:${h};
          ${(isFull || fill) ? "min-height:0;" : ""}
          --cmc-radius: var(--ha-card-border-radius, 12px);
          --cmc-surface: var(--card-background-color, #fff);
          --cmc-text: var(--primary-text-color, #111);
          --cmc-sub: var(--secondary-text-color, #666);
          --cmc-divider: var(--divider-color, rgba(128,128,128,.22));
          --cmc-fill: var(--ha-color-fill-neutral-quiet-resting, rgba(128,128,128,.12));
          --cmc-shadow: var(--ha-box-shadow-m, 0 2px 8px rgba(0,0,0,.22));
        }
        /* ---- 真·全屏：脱离文档流铺满视口 ----
           sections 视图的 grid 格子是固定高度，panel 视图也可能不给卡片高度，
           靠 height:100% 永远突破不了。此处 position:fixed 直接跳出容器。 */
        :host(.cmc-bleed) {
          position:fixed !important;
          top:var(--header-height, 0px) !important;
          left:0 !important; right:0 !important; bottom:0 !important;
          width:auto !important; height:auto !important;
          min-height:0 !important; max-height:none !important;
          margin:0 !important; padding:0 !important;
          border-radius:0 !important;
          z-index:5;
          background:var(--map-background-color, #121212);
        }
        :host(.cmc-bleed) .cmc-card {
          border-radius:0; border:none;
          height:100%; width:100%;
          background:var(--map-background-color, #121212);
        }
        /* 轨迹点悬停提示（v1.0.8）：跟随鼠标的极小浮层 */
        .cmc-tip {
          position:absolute; z-index:30; pointer-events:none; white-space:nowrap;
          padding:3px 7px; border-radius:6px; font-size:11.5px; line-height:1.3;
          font-variant-numeric:tabular-nums;
          background:var(--card-background-color, #fff); color:var(--primary-text-color, #212121);
          box-shadow:0 2px 8px rgba(0,0,0,.28);
          transform:translate(-50%, -100%); transition:opacity .1s;
        }
        .cmc-tip[hidden] { display:none; }
        .cmc-card.is-aspect { height:auto; }
        .cmc-card {
          width:100%; height:100%; position:relative; overflow:hidden;
          border-radius:var(--cmc-radius);
          background:${isFull ? "var(--map-background-color, #121212)" : "var(--cmc-surface)"};
          ${isFull ? "border:none;" : "border:1px solid var(--ha-card-border-color, rgba(0,0,0,.12));"}
          box-sizing:border-box;
        }
        .cmc-map { position:absolute; inset:0; overflow:hidden; cursor:grab; }
        /* ---- 暗色底图：高德/天地图没有暗色瓦片，用 CSS filter 近似（官方矢量图是双配色，
           栅格图只能这么来）。卫星影像与路况叠加带 .cmc-nofilter，不参与反色 ---- */
        .cmc-card.is-dark .cmc-layer:not(.cmc-nofilter) {
          filter: invert(1) hue-rotate(180deg) brightness(.88) contrast(.92) saturate(.75);
        }
        .cmc-map:active { cursor:grabbing; }
        .cmc-title {
          position:absolute; top:0; left:0; right:0; height:44px; z-index:12;
          display:flex; align-items:center; padding:0 16px; font-weight:500;
          font-size:18px; background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow);
        }
        /* ---- 控件：官方 ha-icon-button 外形（48 圆、无底色、白底胶囊分组） ---- */
        .cmc-ctrl {
          position:absolute; z-index:14; display:flex; flex-direction:column; gap:6px;
          top:${cfg.title ? 56 : 8}px;
          ${zoomSide}:8px;
        }
        /* 官方：缩放组在最上，其余图标依次向下 */
        .cmc-ctrl > .cmc-ctrl-group + button { margin-top:2px; }
        .cmc-ctrl-group {
          display:flex; flex-direction:column;
          background:var(--cmc-surface); border-radius:24px;
          box-shadow:var(--cmc-shadow); overflow:hidden;
        }
        .cmc-ctrl-group > button + button { border-top:1px solid var(--cmc-divider); border-radius:0; }
        .cmc-ctrl button {
          width:40px; height:40px; border:none; background:var(--cmc-surface);
          color:var(--cmc-text); cursor:pointer; display:flex; align-items:center;
          justify-content:center; padding:0; border-radius:20px; box-shadow:var(--cmc-shadow);
          transition:background .15s;
          -webkit-tap-highlight-color:transparent;
        }
        .cmc-ctrl-group button { box-shadow:none; border-radius:0; }
        .cmc-ctrl button:hover { background:var(--cmc-fill); }
        .cmc-ctrl button[aria-pressed="true"] { color:var(--primary-color, #03a9f4); }
        .cmc-ctrl svg { width:22px; height:22px; fill:currentColor; pointer-events:none; }
        /* ---- 比例尺：官方左下角白底小块 ---- */
        .cmc-scale {
          position:absolute; left:8px; bottom:8px; z-index:9;
          font-size:11px; color:#111; line-height:1;
          background:rgba(255,255,255,.9); padding:4px 6px; border-radius:3px;
          pointer-events:none; font-variant-numeric:tabular-nums;
          box-shadow:0 0 0 1px rgba(0,0,0,.12);
        }
        .cmc-scale .bar { height:5px; margin-top:3px; border:1px solid #111; border-top:none; }
        /* 底部抽屉展开时把比例尺顶上去，别被压住 */
        .cmc-card:has(.cmc-panel.open.dock-bottom) .cmc-scale { bottom:45%; transition:bottom .28s ease; }
        @media (max-width: 600px) {
          .cmc-card:has(.cmc-panel.open.dock-auto) .cmc-scale { bottom:45%; }
        }
        /* ---- 标记：官方 48px 圆角方块 + 白边 ---- */
        .cmc-marker img { width:44px; height:44px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4); object-fit:cover; display:block; }
        .cmc-marker.is-offline img,
        .cmc-marker.is-offline .cmc-fallback { filter:grayscale(1); opacity:.6; }
        /* 选中高亮：官方聚焦实体时标记带主题色光环 */
        .cmc-marker.is-selected img,
        .cmc-marker.is-selected .cmc-fallback {
          border-color:var(--primary-color, #03a9f4);
          box-shadow:0 0 0 5px color-mix(in srgb, var(--primary-color, #03a9f4) 30%, transparent), 0 1px 4px rgba(0,0,0,.4);
        }
        /* 图标内部禁止 flex 拉伸：ha-icon / img 都会被父级叠加居中，压到文字行上 */
        .cmc-marker > *:first-child { flex:0 0 auto; }
        .cmc-marker .cmc-fallback {
          width:44px; height:44px; margin:0 auto; border-radius:50%; border:3px solid #fff;
          --mdc-icon-size:22px; box-sizing:border-box;
          box-shadow:0 1px 4px rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center;
          font-size:18px; background:#58a6f0; color:#fff;
        }
        .cmc-marker .cmc-label {
          margin-top:3px; font-size:11px; color:#fff; display:inline-block;
          background:rgba(0,0,0,.55); padding:1px 6px; border-radius:8px;
          white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis;
        }
        /* 名称与状态各自成行：inline-block 会让两段文字并排，垂直居中的 padding 叠加后
           下层被地图瓦片盖住（父级只有 44px 图标的视觉空间，靠容器自动高度撑开） */
        .cmc-marker .cmc-label-sub {
          display:block; width:fit-content; max-width:120px; margin:1px auto 0;
          font-size:10px; line-height:1.35; padding:0 5px; border-radius:7px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          background:rgba(0,0,0,.42); opacity:.9;
        }
        .cmc-marker .cmc-label-sub:empty { display:none; }
        .cmc-home { font-size:30px; --mdc-icon-size:30px; color:#ff9800; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
        .cmc-cluster-avatar {
          width:34px; height:34px; border-radius:50%; border:3px solid #58a6f0;
          box-sizing:border-box; background:var(--cmc-surface);
          display:flex; align-items:center; justify-content:center;
          font-size:13px; font-weight:600; color:var(--cmc-text);
          box-shadow:0 1px 4px rgba(0,0,0,.4); overflow:hidden;
        }
        .cmc-cluster-count {
          min-width:34px; height:34px; padding:0 7px; box-sizing:border-box; border-radius:17px;
          background:var(--cmc-surface); color:var(--cmc-text); font-size:13px; font-weight:600;
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 1px 4px rgba(0,0,0,.4); border:2px solid var(--cmc-surface);
        }
        .cmc-panel-btn {
          position:absolute; z-index:19; top:12px; left:12px;
          width:44px; height:44px; border-radius:22px; border:none;
          background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow); cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          padding:0; transition:opacity .2s ease, transform .28s ease;
        }
        .cmc-panel-btn svg { width:22px; height:22px; fill:currentColor; }
        .cmc-panel-btn.hide { opacity:0; pointer-events:none; transform:scale(.6); }
        .cmc-panel-btn:hover { filter:brightness(1.08); }
        /* 手机：抽屉收起后底部留 52px 条，按钮放条上方左侧 */
        @media (max-width: 600px) {
          .cmc-panel-btn { top:auto; bottom:62px; left:10px; }
        }

        .cmc-attribution { color:var(--cmc-sub); }

        /* ================= 概览面板（对齐官方 底部抽屉 / 左侧浮层） ================= */
        .cmc-panel {
          position:absolute; z-index:20; box-sizing:border-box;
          background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow);
          display:flex; flex-direction:column;
          transition:transform .28s ease, max-height .28s ease;
        }
        /* 桌面/面板视图：左侧浮层卡片 */
        .cmc-panel.dock-auto {
          top:12px; left:12px; width:min(340px, calc(100% - 24px));
          max-height:calc(100% - 24px); border-radius:16px; overflow:hidden;
          transform:translateX(calc(-100% - 16px));
        }
        .cmc-panel.dock-auto.open { transform:none; }
        /* 官方：窄屏（手机）改成底部抽屉 */
        @media (max-width: 600px) {
          .cmc-panel.dock-auto {
            top:auto; left:0; right:0; bottom:0; width:auto;
            border-radius:16px 16px 0 0;
            height:max(120px, min(280px, 62%));
            transform:translateY(calc(100% - 52px));
          }
          .cmc-panel.dock-auto.open { transform:none; top:45%; height:auto; }
        }
        /* 底部抽屉（紧凑卡片 / 手机全屏共用）：高度不超过卡片 70% */
        .cmc-panel.dock-bottom {
          left:0; right:0; bottom:0; top:auto; border-radius:16px 16px 0 0;
          height:max(120px, min(280px, 62%));
        }
        .cmc-panel.dock-bottom.open { top:45%; height:auto; }
        /* 详情页（最近活动）内容更高：紧凑卡片里也把抽屉抬高一点，别只剩两行 */
        .cmc-panel.dock-bottom.open.is-detail { top:18%; }
        .cmc-panel.dock-bottom:not(.open) { transform:translateY(calc(100% - 52px)); }
        .cmc-panel-handle {
          flex:none; height:20px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; touch-action:none;
        }
        .cmc-panel-handle::before {
          content:""; width:32px; height:4px; border-radius:2px; background:var(--cmc-divider);
        }
        .cmc-panel-h {
          flex:none; display:flex; align-items:center; gap:8px;
          padding:0 12px 8px;
        }
        /* 面板内的每个子视图自己撑满并滚动（列表 / 详情 / 设置） */
        .cmc-panel > [data-view]:not([hidden]) {
          display:flex; flex-direction:column; flex:1; min-height:0;
        }
        .cmc-tabs {
          position:relative; flex:1; display:flex; gap:4px; padding:4px;
          border-radius:12px; background:var(--cmc-fill);
        }
        .cmc-tabs .pill {
          position:absolute; top:4px; bottom:4px; border-radius:9px;
          background:var(--cmc-surface); box-shadow:0 1px 3px rgba(0,0,0,.18);
          transition:left .2s ease, width .2s ease;
        }
        .cmc-tabs button {
          position:relative; flex:1; min-width:0; border:none; margin:0; padding:8px 6px;
          border-radius:9px; background:none; cursor:pointer; font-family:inherit;
          font-size:14px; font-weight:500; color:var(--cmc-sub);
          transition:color .18s; -webkit-tap-highlight-color:transparent;
        }
        .cmc-tabs button[aria-selected="true"] { color:var(--cmc-text); }
        .cmc-tabs button:disabled { opacity:.4; cursor:default; }
        .cmc-panel-close {
          flex:none; width:36px; height:36px; border:none; background:none;
          color:var(--cmc-sub); cursor:pointer; border-radius:18px; display:flex;
          align-items:center; justify-content:center;
        }
        .cmc-panel-close:hover { background:var(--cmc-fill); }
        .cmc-panel-close svg { width:20px; height:20px; fill:currentColor; }
        .cmc-list { flex:1; min-height:0; overflow-y:auto; padding:0 8px 12px; -webkit-overflow-scrolling:touch; }
        .cmc-item {
          display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box;
          padding:8px; border:none; background:none; cursor:pointer; text-align:left;
          border-radius:12px; font-family:inherit; color:var(--cmc-text);
          -webkit-tap-highlight-color:transparent;
        }
        .cmc-item:hover, .cmc-item:focus-visible { background:var(--cmc-fill); outline:none; }
        .cmc-item-av {
          flex:none; width:44px; height:44px; border-radius:12px; overflow:hidden;
          display:flex; align-items:center; justify-content:center;
          background:var(--cmc-fill); color:var(--cmc-sub);
          font-size:16px; font-weight:600;
        }
        .cmc-item-av img { width:100%; height:100%; object-fit:cover; display:block; }
        .cmc-item-tx { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
        .cmc-item-nm {
          font-size:15px; font-weight:500; white-space:nowrap;
          overflow:hidden; text-overflow:ellipsis;
        }
        .cmc-item-sub {
          font-size:13px; color:var(--cmc-sub); white-space:nowrap;
          overflow:hidden; text-overflow:ellipsis;
        }
        .cmc-empty {
          padding:28px 12px; text-align:center; font-size:13px; color:var(--cmc-sub);
        }

        /* ================= 实体详情 + 最近活动（对齐官方 hui-map-overview） ================= */
        .cmc-det-hd { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
        .cmc-det-name { font-size:15px; font-weight:600; color:var(--cmc-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-det-sub { font-size:12px; color:var(--cmc-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-act { flex:1; min-height:0; padding:0 14px 12px; overflow-y:auto; -webkit-overflow-scrolling:touch; }
        .cmc-act-h {
          display:flex; align-items:center; gap:8px; padding:10px 0 6px;
          font-size:13px; font-weight:600; color:var(--cmc-sub);
        }
        .cmc-act-h svg { width:16px; height:16px; fill:currentColor; }
        .cmc-act-body { display:flex; flex-direction:column; }
        .cmc-act-empty { font-size:12.5px; color:var(--cmc-sub); padding:4px 0 8px; }
        .cmc-act-row {
          display:flex; align-items:center; gap:10px; padding:8px 0;
        }
        .cmc-act-row + .cmc-act-row { border-top:1px solid var(--cmc-divider); }
        .cmc-act-av {
          flex:none; width:32px; height:32px; border-radius:50%; overflow:hidden;
          display:flex; align-items:center; justify-content:center;
          background:var(--cmc-fill); color:var(--cmc-sub); font-size:13px; font-weight:600;
        }
        .cmc-act-av img { width:100%; height:100%; object-fit:cover; display:block; }
        .cmc-act-tx { min-width:0; display:flex; flex-direction:column; gap:1px; }
        .cmc-act-hl { font-size:13.5px; color:var(--cmc-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-act-when { font-size:11.5px; color:var(--cmc-sub); font-variant-numeric:tabular-nums; }
        .cmc-act-more {
          border:none; background:none; cursor:pointer; font-family:inherit;
          color:var(--primary-color, #03a9f4); font-size:13px; padding:8px 0 4px; text-align:left;
        }

        /* ================= 设置面板（复用同一容器） ================= */
        .cmc-set-b { flex:1; min-height:0; overflow-y:auto; padding:4px 14px 14px; display:flex; flex-direction:column; gap:12px; }
        .cmc-set-b label { display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--cmc-sub); }
        .cmc-set-b label.chk { flex-direction:row; align-items:center; justify-content:space-between; gap:8px; font-size:14px; color:var(--cmc-text); }
        .cmc-set-b label.chk input { width:18px; height:18px; accent-color:var(--primary-color,#03a9f4); }
        .cmc-set-b select, .cmc-set-b input[type=text] {
          width:100%; box-sizing:border-box; padding:9px 10px; border-radius:10px;
          border:1px solid var(--cmc-divider); font-size:14px; font-family:inherit;
          background:var(--cmc-surface); color:var(--cmc-text);
        }
        .cmc-set-f {
          flex:none; padding:10px 14px; border-top:1px solid var(--cmc-divider);
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          font-size:11px; color:var(--cmc-sub);
        }
        .cmc-set-f button {
          border:1px solid var(--cmc-divider); background:none; cursor:pointer;
          border-radius:8px; padding:5px 10px; font-size:12px; font-family:inherit;
          color:var(--cmc-text);
        }
      </style>
      <div class="cmc-card">
        <div class="cmc-tip" hidden></div>
        ${titleHtml}
        <div class="cmc-map"></div>

        <div class="cmc-ctrl">
          <div class="cmc-ctrl-group">
            <button data-z="1" aria-label="放大"><svg viewBox="0 0 24 24"><path d="${ICONS.plus}"/></svg></button>
            <button data-z="-1" aria-label="缩小"><svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg></button>
          </div>
          <button data-fit aria-label="显示全部" title="显示全部"><svg viewBox="0 0 24 24"><path d="${ICONS.focus}"/></svg></button>
          <button data-cluster aria-label="标记聚合" title="标记聚合" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="${ICONS.cluster}"/></svg></button>
          <button data-traffic aria-label="实时路况" title="实时路况" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="${ICONS.traffic}"/></svg></button>
          <button data-gear aria-label="地图设置" title="地图设置"><svg viewBox="0 0 24 24"><path d="${ICONS.cog}"/></svg></button>
          <button data-fs aria-label="全屏" title="全屏" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="${ICONS.fullscreen}"/></svg></button>
        </div>

        <div class="cmc-scale" aria-hidden="true"></div>

        <button class="cmc-panel-btn${overlayOpen ? " hide" : ""}" data-panel-btn aria-label="打开面板" title="打开面板">
          <svg viewBox="0 0 24 24"><path d="${ICONS.people}"/></svg>
        </button>
        <div class="cmc-panel dock-${isFull ? "auto" : "bottom"}${overlayOpen ? " open" : ""}" data-panel>          <div class="cmc-panel-handle" data-handle></div>
          <div data-view="list">
            <div class="cmc-panel-h">
              ${isFull ? `<button class="cmc-panel-close" data-back aria-label="收起面板">
                <svg viewBox="0 0 24 24"><path d="${ICONS.chevronLeft}"/></svg>
              </button>` : ""}
              <div class="cmc-tabs" role="tablist">
                <span class="pill"></span>
                <button role="tab" data-tab="people">人</button>
                <button role="tab" data-tab="devices">设备</button>
                <button role="tab" data-tab="zones">区域</button>
              </div>
              <button class="cmc-panel-close" data-panel-close aria-label="收起">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-list" data-list></div>
          </div>
          <div data-view="detail" hidden>
            <div class="cmc-panel-h">
              <button class="cmc-panel-close" data-detail-back aria-label="返回列表">
                <svg viewBox="0 0 24 24"><path d="${ICONS.chevronLeft}"/></svg>
              </button>
              <span class="cmc-det-hd">
                <span class="cmc-det-name" data-det-name></span>
                <span class="cmc-det-sub" data-det-sub></span>
              </span>
              <button class="cmc-panel-close" data-det-close aria-label="收起">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-act">
              <div class="cmc-act-h">
                <svg viewBox="0 0 24 24"><path d="${ICONS.history}"/></svg>
                <span>最近活动</span>
              </div>
              <div class="cmc-act-body" data-activity></div>
            </div>
          </div>
          <div data-view="settings" hidden>
            <div class="cmc-panel-h">
              <span style="flex:1;font-size:16px;font-weight:500">地图设置</span>
              <button class="cmc-panel-close" data-set-close aria-label="返回">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-set-b">
              <label>底图
                <select data-d="basemap">
                  <option value="amap">高德地图</option>
                  <option value="amap-satellite">高德卫星</option>
                  <option value="tianditu">天地图</option>
                  <option value="tianditu-satellite">天地图卫星</option>
                  <option value="osm">OpenStreetMap</option>
                </select>
              </label>
              <label>主题
                <select data-d="theme_mode">
                  <option value="auto">跟随 Home Assistant</option>
                  <option value="light">始终浅色</option>
                  <option value="dark">始终深色</option>
                </select>
              </label>
              <label data-d-row="tianditu tianditu-satellite">天地图 Key
                <input type="text" data-d="tianditu_key" placeholder="粘贴 tk">
              </label>
              <label class="chk"><span>标记聚合</span><input type="checkbox" data-d="show_cluster"></label>
              <label class="chk"><span>显示名称</span><input type="checkbox" data-d="show_labels"></label>
              <label>标签内容
                <select data-d="label_mode">
                  <option value="name">实体名称</option>
                  <option value="state">状态（在家 / 45 km/h）</option>
                  <option value="none">不显示</option>
                </select>
              </label>
              <label class="chk"><span>标记显示状态</span><input type="checkbox" data-d="show_status"></label>
              <label class="chk"><span>GPS 精度圈</span><input type="checkbox" data-d="show_accuracy"></label>
              <label class="chk"><span>显示区域（家）</span><input type="checkbox" data-d="show_zones"></label>
              <label class="chk"><span>区域半径圈</span><input type="checkbox" data-d="show_zone_radius"></label>
              <label class="chk"><span>跳过已隐藏实体</span><input type="checkbox" data-d="respect_hidden"></label>
              <label class="chk"><span>实时路况（仅高德）</span><input type="checkbox" data-d="show_traffic"></label>
              <label>轨迹时长
                <select data-d="hours_to_show">
                  <option value="0">关闭</option>
                  <option value="1">1 小时</option>
                  <option value="6">6 小时</option>
                  <option value="12">12 小时</option>
                  <option value="24">24 小时</option>
                  <option value="48">48 小时</option>
                  <option value="168">7 天</option>
                </select>
              </label>
            </div>
            <div class="cmc-set-f">
              <span>设置保存在本浏览器</span>
              <button data-reset type="button">恢复默认</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 先决定"要不要真正铺满"再建引擎：容器的最终尺寸直接影响首帧视野
    this._applyBleed(this._wantBleed(), true);

    const mapEl = this.shadowRoot.querySelector(".cmc-map");
    this._engine = new CnTileEngine(mapEl);
    this._engine.onTrackHover = (info) => this._showTrackTip(info);
    this._engine.removeTileSets();
    base.layers.forEach((l, i) => {
      this._engine.addTileSet({
        url: (x, y, z) => l.template(x, y, z, cfg.tianditu_key),
        maxZoom: base.maxZoom,
        opacity: l.opacity ?? 1,
        zIndex: i + 1,
        nofilter: !!base.noFilter,
      });
    });
    this._engine.attribution.textContent = base.attribution;
    this._engine.scaleEl = this.shadowRoot.querySelector(".cmc-scale");
    this._engine.addEventListener("marker-click", (e) => {
      const id = e.detail.entityId;
      const ent = this._hass?.states?.[id];
      if (!ent || !this._hass) return;
      // 官方交互：第一次点击=聚焦飞行+选中（打开最近活动详情），第二次点同一标记才打开 more-info
      if (this._focusOnMarkerClick) {
        const wasSelected = this._engine._selectedEntity === id;
        if (wasSelected) {
          this._openMoreInfo(id);
        } else {
          this.focusEntity(id);
        }
      } else {
        this._openMoreInfo(id);
      }
    });
    // 点空白处/Esc 取消选中时：详情页退回列表（官方行为）
    this._engine.addEventListener("selection-cleared", () => {
      if (this._panelView === "detail") {
        this._setPanelView?.("list");
        this._renderList();
      }
    });
    // 卡片里的按钮默认是 type=submit 语义，放在宿主表单/链接里会触发跳转
    this.shadowRoot.querySelectorAll("button").forEach((btn) => btn.setAttribute("type", "button"));

    /* ---- 概览面板（人 / 设备 / 区域）与设置面板共用一个容器 ---- */
    const panel = this.shadowRoot.querySelector("[data-panel]");
    const listView = panel.querySelector('[data-view="list"]');
    const setView = panel.querySelector('[data-view="settings"]');
    const detView = panel.querySelector('[data-view="detail"]');
    this._panelEl = panel;
    this._panelView = this._panelView || "list";

    const showView = (v) => {
      this._panelView = v;
      listView.hidden = v !== "list";
      setView.hidden = v !== "settings";
      detView.hidden = v !== "detail";
      panel.classList.toggle("is-detail", v === "detail");
      if (v === "settings") this._syncDrawer();
    };
    const setOpen = (open) => {
      this._panelOpen = open;
      panel.classList.toggle("open", open);
      // 折叠后没有可点的东西会再也打不开（桌面 dock-auto 整个滑出屏幕），用悬浮按钮兜底
      panel.parentElement?.querySelector("[data-panel-btn]")?.classList.toggle("hide", open);
      if (open) showView(this._panelView || "list");
    };
    this._setPanelOpen = setOpen;
    this._setPanelView = showView;

    // 默认：全屏布局展开列表，紧凑布局收起
    setOpen(overlayOpen || (this._isFull && this._panelView !== "settings" && this._panelUserClosed !== true));

    panel.querySelectorAll("[data-tab]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._tab = b.dataset.tab;
        this._renderList();
      });
    });
    panel.querySelector("[data-handle]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!this._panelOpen);
      if (!this._panelOpen) this._panelUserClosed = true;
    });
    // 折叠后的悬浮弹出按钮（桌面全屏面板折叠后会整体滑出屏幕）
    panel.parentElement?.querySelector("[data-panel-btn]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._panelUserClosed = false;
      setOpen(true);
    });
    panel.querySelector("[data-back]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    // 详情页返回列表
    panel.querySelector("[data-detail-back]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showView("list");
      this._renderList();
    });
    panel.querySelector("[data-det-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    panel.querySelector("[data-panel-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    panel.querySelector("[data-set-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showView("list");
      this._renderList();
    });

    this.shadowRoot.querySelector("[data-gear]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._isFull && this._panelOpen && this._panelView === "settings") {
        showView("list");
        this._renderList();
      } else {
        showView("settings");
        setOpen(true);
      }
    });

    panel.querySelectorAll("[data-d]").forEach((el) => {
      const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => this._onDrawerChange(el));
    });
    // 恢复为 YAML 配置（清掉本浏览器存的设置）
    this.shadowRoot.querySelector("[data-reset]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._resetting) return;
      this._resetting = true;
      try {
        const raw = { ...this._rawConfig };
        delete raw.persist;
        try { window.localStorage.removeItem(this._lsKey || storageKey(raw)); } catch { /* 忽略 */ }
        this.setConfig(raw);
      } finally {
        this._resetting = false;
      }
      this._didFit = false;
      if (this._hass) this._update();
    });

    // 聚合快捷开关
    const clusterBtn = this.shadowRoot.querySelector("[data-cluster]");
    if (clusterBtn) {
      clusterBtn.setAttribute("aria-pressed", String(cfg.show_cluster !== false));
      clusterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = !(this._config.show_cluster !== false);
        this._config = { ...this._config, show_cluster: next };
        this._saveRuntime();
        clusterBtn.setAttribute("aria-pressed", String(next));
        this._update();
        this._persistConfig(this._config);
      });
    }

    // 路况快捷开关
    const trafficBtn = this.shadowRoot.querySelector("[data-traffic]");
    if (trafficBtn) {
      trafficBtn.setAttribute(
        "aria-pressed",
        String(!!(cfg.show_traffic && String(cfg.basemap).startsWith("amap")))
      );
    }
    trafficBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = !this._config.show_traffic;
      this._config = { ...this._config, show_traffic: next };
      this._saveRuntime();
      trafficBtn.setAttribute("aria-pressed", String(next && String(this._config.basemap).startsWith("amap")));
      // 路况是叠加层，不必重建整个卡片
      const traffic = BASEMAPS.traffic;
      const want = next && String(this._config.basemap).startsWith("amap");
      this._engine.setOverlay(
        "traffic",
        want ? { maxZoom: traffic.maxZoom, layers: traffic.layers.map((l) => ({ template: l.template, opacity: l.opacity })) } : null
      );
      this._syncDrawer();
      this._persistConfig(this._config);
    });

    this.shadowRoot.querySelector("[data-fit]")?.addEventListener("click", () => {
      this._didFit = false;
      this._engine._userMoved = false;
      this._update();
    });
    this.shadowRoot.querySelectorAll("[data-z]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._engine.setZoom(this._engine.zoom + Number(b.dataset.z));
      });
    });
    this.shadowRoot.querySelector("[data-fs]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      // 浏览器原生 fullscreen 在 HA App 的 WebView 里基本无效（只对 <video> 生效），
      // 所以这里用 CSS 的 position:fixed 铺满视口 —— 任何视图类型都能用。
      this._toggleBleed();
    });
    // 全屏时点地图空白处不收起面板（官方行为），只在面板外点按才收起
    document.addEventListener("fullscreenchange", this._onFsChange = () => {
      if (document.fullscreenElement === this) this._engine?.render();
    });

    // 实时路况：仅高德底图支持（路况瓦片与底图同属 GCJ-02 坐标系）
    const traffic = BASEMAPS.traffic;
    const wantTraffic = !!cfg.show_traffic && String(cfg.basemap).startsWith("amap");
    this._engine.setOverlay(
      "traffic",
      wantTraffic
        ? { maxZoom: traffic.maxZoom, layers: traffic.layers.map((l) => ({ template: l.template, opacity: l.opacity })) }
        : null
    );

    this._basemapShift = base.needsShift;
    // 主题：重建 DOM 后要把暗色类补回来（_render 会换掉整个 shadowRoot）
    this._dark = this._resolveDark();
    this.shadowRoot.querySelector(".cmc-card")?.classList.toggle("is-dark", !!this._dark);
    if (prevView) {
      this._engine.center = prevView.c;
      this._engine.zoom = prevView.z;
      this._engine._userMoved = prevView.moved;
      if (prevView.sel && this._hass?.states?.[prevView.sel]) {
        this._engine.setSelected(prevView.sel);
      }
    }
    if (this._hass) this._update(); else this._engine.render();
    // 必须补一帧：_didFit 已为 true 时 _update 走不到 render()，
    // 换底图后地图会是一片空白（v1.0.3 修）
    this._engine.render();
    this._applyAspect();
    this._applyConditions();   // 换配置后立即评估（不满足时连渲染都省掉）
    this._renderList();
  }

  _collectEntities() {
    const hass = this._hass;
    if (!hass) return [];
    const cfg = this._config;
    // 去重：person 的 attributes.source 指向它的位置来源 device_tracker，
    // 两者坐标完全重合，自动模式下只画 person（官方 hui-map-card 的 _getAllEntities 同样处理）。
    // 用户显式写在 entities: 里的保持原样，不替他做决定。
    const personSources = new Set();
    if (cfg.dedupe_trackers !== false) {
      Object.values(hass.states).forEach((st) => {
        if (st.entity_id.startsWith("person.") && st.attributes?.source) {
          personSources.add(st.attributes.source);
        }
      });
    }
    let ids = [];
    if (cfg.entities?.length) {
      // entities 支持字符串与对象两种写法（对象：{entity, color, name, label_mode, attribute, unit}）。
      // 之前直接 [...cfg.entities] 原样拷贝，对象条目会被 hass.states[id] 查成 undefined 滤掉——
      // 只写 entities 不开 show_all 时对象实体根本不上地图（v1.1.4 顺带修）
      ids = cfg.entities.map((e) => (typeof e === "object" ? e.entity : e)).filter(Boolean);
    }
    if (cfg.show_all) {
      const skipHidden = cfg.respect_hidden !== false && this._hiddenIds;
      ids = Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        if (skipHidden && this._hiddenIds.has(id)) return false;
        if (personSources.has(id)) return false;
        return d?.attributes?.latitude != null && (id.startsWith("person.") || id.startsWith("device_tracker.") || id.startsWith("geo_location."));
      });
    }
    if (cfg.geo_location_sources?.length) {
      const skipHiddenGeo = cfg.respect_hidden !== false && this._hiddenIds;
      ids.push(...Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        if (skipHiddenGeo && this._hiddenIds.has(id)) return false;
        return id.startsWith("geo_location.") && cfg.geo_location_sources.includes(d.attributes?.source);
      }));
    }
    return [...new Set(ids)].map((id) => hass.states[id]).filter(Boolean);
  }

  /* ---- 轨迹：订阅 history/stream，按实体画折线 ---- */
  _syncTracks(states) {
    if (this._preview) return; // 预览态不订阅轨迹，省一次 WS 请求
    const cfg = this._config;
    const hours = Number(cfg.hours_to_show) || 0;
    if (hours <= 0) {
      if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
      this._trackSig = "";
      this._trackPoints = {};
      this._engine.clearPaths();
      return;
    }
    const ids = states.map((s) => s.entity_id).sort();
    const sig = `${hours}|${ids.join(",")}`;
    if (sig === this._trackSig) {
      this._paintTracks();
      return;
    }
    this._trackSig = sig;
    if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }

    const conn = this._hass?.connection;
    if (!conn || !conn.subscribeMessage) return;

    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    this._trackPoints = {};
    Promise.resolve(
      conn.subscribeMessage(
        (msg) => {
          if (!msg?.states) return;
          Object.entries(msg.states).forEach(([id, arr]) => {
            const pts = (arr || [])
              .map((st) => {
                const lat = st.a?.latitude, lng = st.a?.longitude;
                if (typeof lat !== "number" || typeof lng !== "number") return null;
                // history/stream 的时间字段：minimal_response 下是 lc(秒)，否则可能是 ISO
                const raw = st.lc ?? st.last_changed ?? st.lu ?? st.last_updated ?? null;
                let t = null;
                if (typeof raw === "number") t = raw < 1e12 ? raw * 1000 : raw;
                else if (typeof raw === "string") { const ms = Date.parse(raw); t = Number.isFinite(ms) ? ms : null; }
                return { lat, lng, t };
              })
              .filter(Boolean);
            this._trackPoints[id] = pts;
          });
          this._paintTracks();
        },
        {
          type: "history/stream",
          entity_ids: ids,
          start_time: start,
          minimal_response: false,
          significant_changes_only: false,
          no_attributes: false,
        }
      )
    )
      .then((unsub) => { this._trackUnsub = unsub; })
      .catch(() => { this._trackUnsub = null; });
  }

  _paintTracks() {
    const cfg = this._config;
    const shift = this._basemapShift;
    const paths = [];
    Object.entries(this._trackPoints).forEach(([id, pts]) => {
      if (!pts || pts.length < 2) return;
      const color =
        (cfg.entities || []).find((e) => (typeof e === "object" ? e.entity : e) === id)?.color ||
        this._hass?.states?.[id]?.attributes?.color ||
        "#03a9f4";
      paths.push({
        entityId: id,
        color,
        width: Number(cfg.track_width) || 3,
        opacity: cfg.track_opacity ?? 0.85,
        points: pts.map((p) => {
          if (!shift) return p;
          const [gl, gn] = GCJ.wgs2gcj(p.lat, p.lng);
          return { lat: gl, lng: gn, t: p.t };
        }),
      });
    });
    this._engine.setPaths(paths);
  }

  /* 轨迹点悬停：显示该点的 HH:MM 与相对时间（官方轨迹 tooltip 语义） */
  _showTrackTip(info) {
    const tip = this.shadowRoot?.querySelector(".cmc-tip");
    if (!tip) return;
    if (!info || !info.t) { tip.hidden = true; return; }
    const d = new Date(info.t);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    tip.textContent = `${hh}:${mm} · ${this._relTime(d.toISOString())}`;
    const host = this.shadowRoot.querySelector(".cmc-card").getBoundingClientRect();
    tip.style.left = `${Math.round(info.x - host.left)}px`;
    tip.style.top = `${Math.round(info.y - host.top - 8)}px`;
    tip.hidden = false;
  }

  /* 抽屉：值同步 */
  _syncDrawer() {
    const d = this.shadowRoot.querySelector('[data-view="settings"]');
    if (!d) return;
    const c = this._config;
    d.querySelectorAll("[data-d]").forEach((el) => {
      const k = el.dataset.d;
      // 默认开启的开关：值缺省时按 true 显示
      if (el.type === "checkbox") el.checked = c[k] === undefined ? ["show_cluster", "show_labels", "show_status", "show_accuracy", "show_zone_radius", "respect_hidden"].includes(k) : !!c[k];
      else if (k === "hours_to_show") el.value = String(Number(c[k]) || 0);
      else if (k === "theme_mode") el.value = c[k] || "auto";
      else if (k === "label_mode") el.value = c[k] || "name";
      else el.value = c[k] === undefined ? "" : c[k];
    });
    const bm = c.basemap || "amap";
    d.querySelectorAll("[data-d-row]").forEach((el) => {
      el.style.display = el.dataset.dRow.split(" ").includes(bm) ? "" : "none";
    });
  }

  /* 抽屉：改配置 → 立即重绘 + 存到本浏览器 + 通知外部 */
  _onDrawerChange(el) {
    const k = el.dataset.d;
    let v;
    if (el.type === "checkbox") v = el.checked;
    else if (k === "hours_to_show") v = Number(el.value) || 0;
    else v = el.value;

    const cfg = { ...this._config };
    if (el.type === "checkbox") {
      cfg[k] = v;               // false 也是有效状态，不能当"未设置"删掉
    } else if (k === "hours_to_show") {
      cfg[k] = Number(v) || 0;
    } else if (v === "") {
      delete cfg[k];
    } else {
      cfg[k] = v;
    }
    this._config = cfg;
    this._saveRuntime();
    // 注意：_render() 会把 shadow DOM 整个换掉，而此刻事件还在往当前元素冒泡，
    // 直接重建会让监听器执行到一半节点就没了。放到微任务里再重建。
    // theme_mode 也要重建：暗色类是挂在 .cmc-card 上的，_update 不会改它
    const rebuild = ["basemap", "theme_mode", "tianditu_key", "show_traffic", "hours_to_show", "height"].includes(k);
    if (rebuild) {
      Promise.resolve().then(() => {
        this._render();
        // 重建后把面板恢复到"设置"页并保持展开，用户视角不跳
        this._panelOpen = true;
        this._panelUserClosed = false;
        this._setPanelOpen?.(true);
        this._setPanelView?.("settings");
      });
    } else {
      Promise.resolve().then(() => this._update());
    }
    this._persistConfig(cfg);
  }

  /* 卡片内改配置：如果 HA 给了 setConfig 能力就回写，否则只影响本次显示 */
  _persistConfig(cfg) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: cfg },
        bubbles: true,
        composed: true,
      })
    );
  }

  disconnectedCallback() {
    if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
    if (this._onFsChange) document.removeEventListener("fullscreenchange", this._onFsChange);
    if (this._onKeyBleed) this.removeEventListener("keydown", this._onKeyBleed);
    if (this._onDocKey) { document.removeEventListener("keydown", this._onDocKey); this._onDocKey = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  connectedCallback() {
    // 全局 Esc：详情页退回列表（点标记后焦点不在引擎容器上，引擎那层键盘处理接不到）
    if (!this._onDocKey) {
      this._onDocKey = (e) => {
        if (e.key !== "Escape") return;
        if (this._panelView === "detail") {
          this._engine?.setSelected(null);
          this._setPanelView?.("list");
          this._renderList?.();
          e.preventDefault();
        } else if (this.classList.contains("cmc-bleed") && this._bleedUser !== false) {
          this._bleedUser = false;
          this._applyBleed(false);
        }
      };
      document.addEventListener("keydown", this._onDocKey);
    }
    // panel 视图撑满容器后尺寸会变，重新算布局 + 重绘瓦片
    if (typeof ResizeObserver === "function" && !this._ro) {
      this._ro = new ResizeObserver(() => {
        const layoutNow = this._resolveLayout();
        if (layoutNow !== this._layout) {
          this._syncLayout();
        } else {
          // 尺寸变了：先看要不要自愈成全屏，再重铺瓦片
          this._syncBleed();
          this._engine?.render();
        }
      });
      this._ro.observe(this);
    }
    // 首帧后再判一次：刚挂上时祖先尺寸可能还没稳定
    Promise.resolve().then(() => this._syncBleed());
  }

  /* 布局变了（panel 视图赋值 / 尺寸变化）时重建，并保住当前视野 */
  _syncLayout() {
    const view = this._engine ? { c: this._engine.center, z: this._engine.zoom } : null;
    this._layout = this._resolveLayout();
    this._isFull = this._layout === LAYOUT.FULL;
    this._render();
    if (view && this._engine) {
      this._engine.center = view.c;
      this._engine.zoom = view.z;
      this._engine.render();
    }
    if (this._hass) this._update();
  }

  /* 打开实体详情弹窗。
     HA 没有 homeassistant.more_info 这个服务（已对实例实测：该域只有 turn_on /
     toggle / restart 等），旧代码 callService 属于静默失败。正确做法与官方一致：
     发 hass-more-info 事件，composed 才能穿出 shadow root 被 lovelace 接住。 */
  _openMoreInfo(entityId) {
    if (!entityId) return;
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  /* 聚焦缩放：只放大到"和最近的其它标记拉开 80px"为止（官方 FOCUS_CLEARANCE_PX），
     上限 17 级。人多且挨得近时不会一杆戳到街景级；单独一个实体才允许明显拉近。 */
  _focusZoom(lat, lng, base) {
    const n = 2 ** base;
    const c = CnTileEngine.project(lat, lng);
    let nearest = Infinity;
    (this._lastMarkers || []).forEach((m) => {
      const p = CnTileEngine.project(m.lat, m.lng);
      const d = Math.hypot((p.x - c.x) * n * 256, (p.y - c.y) * n * 256);
      if (d > 0.5) nearest = Math.min(nearest, d); // 跳过自己（同一坐标）
    });
    if (!Number.isFinite(nearest)) return Math.min(17, base + 2);
    return Math.max(base, Math.min(17, base + Math.log2(80 / nearest)));
  }

  /* 聚焦实体：官方点击标记 / 点击列表项的"选中 + 飞行"语义。
     全屏且面板展开时，把目标点放在让开面板后的可视区域中心 */
  /* URL 深链：?entity_id=person.zhangsan / ?entity=… / #person.zhangsan 都可。
     用途是把「某人现在在哪」做成可分享的链接；只读不写回，免得污染用户地址栏 */
  _applyUrlSelection() {
    if (this._urlApplied || !this._hass) return;
    let raw = "";
    try {
      const q = new URLSearchParams(window.location.search);
      raw = q.get("entity_id") || q.get("entity") || "";
    } catch (_) { /* 某些内嵌 WebView 没有 URLSearchParams */ }
    const hash = String(window.location.hash || "").replace(/^#/, "");
    if (!raw && hash) {
      if (hash.includes("=")) {
        try {
          const hp = new URLSearchParams(hash);
          raw = hp.get("entity_id") || hp.get("entity") || "";
        } catch (_) {}
      } else if (/^(person|device_tracker|zone|geo_location)\./.test(hash)) {
        raw = hash;
      }
    }
    if (!raw) return;
    let id = raw;
    try { id = decodeURIComponent(raw); } catch (_) {}
    const st = this._hass.states[id];
    if (!st || typeof st.attributes.latitude !== "number") return;
    this._urlApplied = true;
    this.focusEntity(id);
  }

  focusEntity(entityId, zoom) {
    const st = this._hass?.states?.[entityId];
    if (!st || typeof st.attributes.latitude !== "number") return;
    let lat = st.attributes.latitude, lng = st.attributes.longitude;
    // 标记是按底图坐标系画的（高德要 GCJ-02 纠偏），聚焦必须用同一套坐标，
    // 否则飞过去会差 300~500m（v1.0.1 修）
    if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
    this._engine.setSelected(entityId);
    // 选中即打开详情（最近活动），对齐官方 hui-map-overview 的聚焦语义
    this._showDetail(entityId);
    const z = this._focusZoom(lat, lng, Math.max(zoom ?? 0, this._engine.zoom, 13));
    let offX = 0, offY = 0; // 像素偏移：面板 dock 在哪侧就把中心往对侧挪
    if (this._isFull && this._panelOpen) {
      const dockBottom = window.innerWidth <= 600;
      const pad = this._fitPadding();
      // 屏幕 y 向下、世界 y 也向下：想让目标出现在中心"上方"（避开底部抽屉），
      // 中心就得往南挪（lat 减）；想让目标出现在中心"右侧"（避开左侧浮层），
      // 中心就得往西挪（lng 减）。符号错了目标会被推到面板底下（v1.0.1 修）
      if (dockBottom) offY = -pad * 0.35;
      else offX = -pad * 0.35;
    }
    // 像素偏移 → 经纬度偏移（当前 zoom 下）
    const mPerLng = 360 / (2 ** z * 256);
    const mPerLat = mPerLng / Math.cos((lat * Math.PI) / 180);
    this._engine.flyTo(lat + offY * mPerLat, lng + offX * mPerLng, z);
  }

  /* ---- 实体详情（最近活动）---- */
  _showDetail(entityId) {
    if (!this._hass?.states?.[entityId]) return;
    const changed = this._detailEntity !== entityId;
    this._detailEntity = entityId;
    this._setPanelView?.("detail");
    this._setPanelOpen?.(true);
    this._panelUserClosed = false;
    this._renderDetailHeader();
    // 同一实体只拉一次历史；切到别的实体重新拉
    if (changed || !this._actEntries) this._loadActivity(entityId);
  }

  _renderDetailHeader() {
    const st = this._hass?.states?.[this._detailEntity];
    if (!st) return;
    const nameEl = this.shadowRoot.querySelector("[data-det-name]");
    const subEl = this.shadowRoot.querySelector("[data-det-sub]");
    if (!nameEl || !subEl) return;
    nameEl.textContent = st.attributes.friendly_name || this._detailEntity;
    const rel = this._relTime(st.last_updated || st.last_changed);
    let state;
    if (this._detailEntity.startsWith("zone.")) {
      const n = Number(st.state);
      state = Number.isNaN(n) ? "" : `${n} 人在此`;
    } else if (OFFLINE_STATES.has(String(st.state).toLowerCase())) {
      state = "离线";
    } else {
      const z = this._zoneForState(st, this._listEntries().zones);
      state = z ? `在 ${z.attributes.friendly_name || "区域"}` : st.state === "not_home" ? "离家" : st.state === "home" ? "在家" : st.state;
    }
    subEl.textContent = rel && state ? `${state} · ${rel}` : state || rel;
  }

  /* 最近 24h 活动时间线：官方 ACTIVITY_HOURS=24 / 最多 20 条 / 默认显示 5 条 */
  static ACTIVITY_MAX = 20;
  async _loadActivity(entityId) {
    const req = (this._actReq = (this._actReq || 0) + 1);
    const bodyEl = this.shadowRoot.querySelector("[data-activity]");
    if (!bodyEl) return;
    this._actFailed = false;
    this._actEntries = null;
    this._actExpanded = false;
    bodyEl.innerHTML = `<div class="cmc-act-empty">加载中…</div>`;
    const isZone = entityId.startsWith("zone.");
    // zone 详情 = 全部人员进出该区域；实体详情 = 自己的状态变化
    const ids = isZone ? this._listEntries().people.map((s) => s.entity_id) : [entityId];
    if (!ids.length) {
      this._actEntries = [];
      this._renderActivity();
      return;
    }
    let history = null;
    try {
      // 与官方 fetchDateWS 同一条 WebSocket 消息
      history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: ids,
        minimal_response: false,
        no_attributes: false,
      });
    } catch {
      history = null;
    }
    if (req !== this._actReq) return; // 加载期间用户切到了别的实体
    this._actFailed = history === null;
    this._actEntries = this._computeActivity(entityId, history, isZone, ids);
    this._renderActivity();
  }

  _computeActivity(entityId, history, isZone, personIds) {
    const NO_LOC = ["unavailable", "unknown"];
    const since = Date.now() - 24 * 3600 * 1000;
    const out = [];
    if (isZone) {
      for (const pid of personIds) {
        const person = this._hass?.states?.[pid];
        let wasIn;
        for (const e of history?.[pid] || []) {
          if (NO_LOC.includes(e.s)) continue;
          const inZone = Array.isArray(e.a?.in_zones) ? e.a.in_zones.includes(entityId) : false;
          // 窗口开始时的第一帧不算事件；只有进/出的变化才算
          const isEvent = wasIn === undefined ? inZone : inZone !== wasIn;
          if (isEvent && e.lu * 1000 >= since) {
            out.push({ entityId: pid, name: person?.attributes?.friendly_name || pid, picture: person?.attributes?.entity_picture, when: e.lu * 1000, arrived: inZone });
          }
          wasIn = inZone;
        }
      }
      out.sort((a, b) => b.when - a.when);
    } else {
      let prev;
      for (const e of history?.[entityId] || []) {
        if (NO_LOC.includes(e.s)) continue;
        if (e.s === prev) continue; // 只留状态变化
        prev = e.s;
        if (e.lu * 1000 < since) continue;
        out.push({ entityId, state: e.s, when: e.lu * 1000 });
      }
      out.reverse(); // 最新在前
    }
    return out.slice(0, HaCnMapCard.ACTIVITY_MAX);
  }

  _renderActivity() {
    const bodyEl = this.shadowRoot.querySelector("[data-activity]");
    if (!bodyEl) return;
    if (this._actFailed) {
      bodyEl.innerHTML = `<div class="cmc-act-empty">活动记录不可用</div>`;
      return;
    }
    const list = this._actEntries;
    if (!list || !list.length) {
      bodyEl.innerHTML = `<div class="cmc-act-empty">最近 24 小时没有活动</div>`;
      return;
    }
    const shown = this._actExpanded ? list : list.slice(0, 5);
    const hhmm = (t) => {
      const d = new Date(t);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const rows = shown.map((en) => {
      let hl, prefix = "";
      if (en.arrived !== undefined) {
        // 区域详情：谁进入 / 离开
        hl = escapeHtml(en.name);
        prefix = en.arrived ? "进入" : "离开";
      } else {
        hl = escapeHtml(this._activityHeadline(en.state));
      }
      const ent = this._hass?.states?.[en.entityId];
      const nm = en.name || ent?.attributes?.friendly_name || en.entityId;
      const pic = en.picture || ent?.attributes?.entity_picture;
      const av = pic
        ? `<img src="${escapeAttr(pic)}" referrerpolicy="no-referrer" alt="">`
        : this._initial(nm);
      return `<div class="cmc-act-row">
        <span class="cmc-act-av" data-i="${escapeAttr(this._initial(nm))}">${av}</span>
        <span class="cmc-act-tx">
          <span class="cmc-act-hl">${hl}</span>
          <span class="cmc-act-when">${prefix ? `${prefix} · ` : ""}${hhmm(en.when)} · ${escapeHtml(this._relTime(en.when) || "刚刚")}</span>
        </span>
      </div>`;
    });
    bodyEl.innerHTML = `<div class="cmc-act-body-inner">${rows.join("")}</div>${
      list.length > shown.length
        ? `<button class="cmc-act-more" data-act-more type="button">显示全部 ${list.length} 条</button>`
        : ""
    }`;
    bodyEl.querySelector("[data-act-more]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._actExpanded = true;
      this._renderActivity();
    });
    // 头像加载失败（离线/失效的 entity_picture）→ 回落到首字母
    bodyEl.querySelectorAll(".cmc-act-av img").forEach((img) => {
      img.addEventListener("error", () => {
        const box = img.parentElement;
        box.textContent = box.dataset.i || "?";
      });
    });
  }

  /* 状态值 → 人话：zone object_id / home / not_home / 其它 */
  _activityHeadline(state) {
    const s = String(state);
    if (s === "home") return "在家";
    if (s === "not_home") return "离家";
    const z = this._hass?.states?.[`zone.${s}`];
    if (z) return `在 ${z.attributes?.friendly_name || s}`;
    return s;
  }

  /* ---- 条件显示（官方条件卡片语义）----
     conditions: [{entity, state?, state_not?, attribute?}]，全部满足才显示。
     entity 不存在视为不满足；空/缺省永远显示。attribute 存在时比较属性值而非状态 */
  _meetsConditions() {
    const cs = this._config?.conditions;
    const hass = this._hass;
    if (!Array.isArray(cs) || !cs.length || !hass) return true;
    return cs.every((c) => {
      const st = c?.entity ? hass.states[c.entity] : null;
      if (!st) return false;
      const val = c.attribute != null
        ? String(st.attributes?.[c.attribute])
        : String(st.state);
      if (c.state != null && val !== String(c.state)) return false;
      if (c.state_not != null && val === String(c.state_not)) return false;
      return true;
    });
  }

  /* 评估条件并切换整卡可见性；返回 true = 当前隐藏，_update 不必再走渲染 */
  _applyConditions() {
    const ok = this._meetsConditions();
    if (typeof this.style !== "undefined") this.style.display = ok ? "" : "none";
    return !ok;
  }

  _update() {
    if (this._applyConditions()) return;   // conditions 不满足：整卡隐藏，布局不留空白
    const hass = this._hass, cfg = this._config;
    const states = this._collectEntities();
    const markers = [];
    const pts = [];

    states.forEach((s) => {
      const { latitude, longitude, friendly_name } = s.attributes;
      if (latitude == null) return;
      let lat = latitude, lng = longitude;
      if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
      const pic = s.attributes.entity_picture;
      // 按域给默认图标，避免实体自带的地图类 icon（如 map-marker-radius）显示成放大镜
      const domain = s.entity_id.split(".")[0];
      const domainIcon =
        domain === "person" ? "mdi:account"
        : domain === "device_tracker" ? "mdi:cellphone-marker"
        : "mdi:map-marker";
      const icon = s.attributes.icon || domainIcon;
      // 每实体配置：{ entity, color, name, label_mode, attribute, unit }
      const conf = (cfg.entities || []).find((e) => (typeof e === "object" ? e.entity : e) === s.entity_id);
      const name = conf?.name || friendly_name || s.entity_id;
      const color =
        conf?.color ||
        s.attributes.color ||
        (domain === "person" ? "#58a6f0" : "#8bc34a");
      markers.push({
        lat, lng, entityId: s.entity_id,
        picture: pic || "",
        color,
        short: name,
        clusterable: true,
        icon,
        label: cfg.show_labels === false ? "" : this._markerLabel(s, conf, cfg, name),
        sub: cfg.show_status === false ? "" : this._markerSub(s, states),
        offline: OFFLINE_STATES.has(String(s.state).toLowerCase()),
      });
      pts.push({ lat, lng }); // fitBounds 必须用底图坐标系（已纠偏），否则自动适配中心偏 500m
    });

    const zoneCircles = [];
    if (cfg.show_zones) {
      Object.values(hass.states).filter((s) => s.entity_id.startsWith("zone.")).forEach((z) => {
        const { latitude, longitude, friendly_name, passive, radius } = z.attributes;
        if (latitude == null || passive) return;
        let lat = latitude, lng = longitude;
        if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
        const name = friendly_name || z.entity_id;
        markers.push({
          lat, lng,
          entityId: z.entity_id,
          short: name,
          label: cfg.show_labels === false ? "" : name,
          clusterable: false,   // 家/区域不参与聚合，永远单独显示
          home: true,
          icon: z.attributes.icon || "mdi:home",
        });
        pts.push({ lat, lng });
        // 区域半径圈：radius 才是 zone 的核心属性（官方把 zone 画成带半径的圆）。
        // 旧版本只画小房子图标，半径信息完全丢失（v1.0.2 补）
        const r = Number(radius);
        if (cfg.show_zone_radius !== false && Number.isFinite(r) && r > 0) {
          zoneCircles.push({
            entityId: z.entity_id,
            lat, lng,
            radius: r,
            color: this._zoneColor(z),
            dashed: true,
            fillOpacity: 0.12,
            strokeOpacity: 0.55,
            strokeWidth: 2,
          });
          if (cfg.fit_zones) {
            // 半径圈的四极值点也纳入自动适配，否则大区域会被裁掉半圈
            const dLat = r / 111320;
            const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
            pts.push({ lat: lat + dLat, lng }, { lat: lat - dLat, lng });
            pts.push({ lat, lng: lng + dLng }, { lat, lng: lng - dLng });
          }
        }
      });
    }

    this._lastMarkers = markers; // 聚焦缩放要用显示坐标（已按底图纠偏）算最近标记
    this._engine.setMarkers(markers, { cluster: cfg.show_cluster !== false });
    this._syncTracks(states);
    // 圈层：区域半径圈在下、GPS 精度圈在上（都在轨迹层，标记之下）
    const circles = [...zoneCircles];
    if (cfg.show_accuracy !== false) {
      states.forEach((s) => {
        const acc = Number(s.attributes.gps_accuracy);
        const { latitude, longitude } = s.attributes;
        if (!Number.isFinite(acc) || acc <= 0 || latitude == null) return;
        if (s.entity_id.startsWith("zone.")) return;
        let clat = latitude, clng = longitude;
        if (this._basemapShift) [clat, clng] = GCJ.wgs2gcj(clat, clng);
        const color =
          (cfg.entities || []).find((e) => (typeof e === "object" ? e.entity : e) === s.entity_id)?.color ||
          s.attributes.color ||
          (s.entity_id.split(".")[0] === "person" ? "#58a6f0" : "#8bc34a");
        circles.push({ entityId: s.entity_id, lat: clat, lng: clng, radius: acc, color });
      });
    }
    this._engine.setAccuracyCircles(circles);
    // 只在首次、且用户还没手动拖动/缩放时自动适配视野
    if (cfg.fit_entities && pts.length && !this._didFit && !this._engine._userMoved) {
      // 全屏时给概览面板留出空间，免得标记被面板盖住
      this._engine.fitBounds(pts, this._fitPadding());
      this._didFit = true;
    } else if (!this._didFit) {
      this._engine.render();
    }
    // URL 深链：链接里带 ?entity_id=… 时首次渲染后直接定位到该实体
    this._applyUrlSelection();
    // 详情页开着时保证标记仍处于选中态：setMarkers 重建 DOM 时若找不到会把它清空
    if (this._panelView === "detail" && this._detailEntity &&
        this._engine._selectedEntity !== this._detailEntity) {
      this._engine.setSelected(this._detailEntity);
    }
    // 列表里的状态文字（"离家 · 4 分钟前"）需要跟着 hass 刷新
    if (this._panelView === "detail") this._renderDetailHeader();
    else if (this._panelView !== "settings") this._renderList();
  }

  /* 自动适配时的内边距：全屏 + 面板展开时避开面板覆盖区
     （padding 会从可用宽高里扣两次，所以必须 clamp，否则会算出负数把缩放压到 3 级） */
  _fitPadding() {
    const w = this._engine?.container.clientWidth || 400;
    const h = this._engine?.container.clientHeight || 300;
    const base = Math.round(Math.min(w, h) * 0.08);
    if (!this._isFull || !this._panelOpen) return base;
    const pad = window.innerWidth <= 600
      ? Math.round(h * 0.26)          // 底部抽屉
      : Math.round(w * 0.28) + 12;    // 左侧浮层
    // 最多留 35%，保证剩余区域还能容纳标记
    return Math.max(base, Math.min(pad, Math.floor(Math.min(w, h) * 0.35)));
  }

  /* ---- 概览列表（对齐官方 hui-map-overview 的分组与文案） ---- */
  _listEntries() {
    const hass = this._hass;
    if (!hass) return { people: [], devices: [], zones: [] };
    const ids = new Set(this._collectEntities().map((e) => e.entity_id));
    const people = [], devices = [], zones = [];
    ids.forEach((id) => {
      const st = hass.states[id];
      if (!st) return;
      if (id.startsWith("person.")) people.push(st);
      else if (id.startsWith("device_tracker.") || id.startsWith("geo_location.")) devices.push(st);
    });
    // 区域：该区域里有人时计数才有意义
    Object.values(hass.states).forEach((st) => {
      if (st.entity_id.startsWith("zone.") && !st.attributes.passive) zones.push(st);
    });
    const hasLoc = (st) => st.attributes.latitude != null;
    people.sort((a, b) => (hasLoc(b) ? 1 : 0) - (hasLoc(a) ? 1 : 0));
    devices.sort((a, b) => (hasLoc(b) ? 1 : 0) - (hasLoc(a) ? 1 : 0));
    return { people, devices, zones };
  }

  /* 标记下方的短状态行：对齐官方 hui-map-marker 的副标题语义
     优先级：离线 > 区域名（在家/在公司）> 速度 > 电量 > 离家 > 相对时间 */
  /* 官方 label_mode 语义：name（默认）| state | attribute | none。
     每实体配置（entities 里的对象）优先于全局；attribute 模式取 conf.attribute */
  _markerLabel(st, conf, cfg, name) {
    const mode = conf?.label_mode || cfg.label_mode || "name";
    if (mode === "none") return "";
    if (mode === "state") {
      const raw = String(st.state ?? "");
      if (!raw || raw === "unknown" || raw === "unavailable") return name;
      // 官方规范要求用 hass.formatEntityState 而不是原始状态（能拿到"在家"/"45 km/h"这类本地化文本）
      let v = raw, formatted = false;
      try {
        if (typeof this._hass?.formatEntityState === "function") {
          v = this._hass.formatEntityState(st);
          formatted = v !== raw;
        }
      } catch (_) {}
      const unit = conf?.unit || st.attributes.unit_of_measurement || "";
      return !formatted && unit && /^[\d.,+-]+$/.test(v) ? `${v} ${unit}` : v;
    }
    if (mode === "attribute") {
      const attr = conf?.attribute;
      const raw = attr ? st.attributes[attr] : null;
      if (raw == null || raw === "") return name;
      const unit = conf?.unit || (attr === "battery" ? "%" : "");
      return unit ? `${raw} ${unit}` : String(raw);
    }
    return name;
  }

  _markerSub(st, all) {
    const state = String(st.state ?? "").toLowerCase();
    if (OFFLINE_STATES.has(state)) return "离线";
    const a = st.attributes || {};
    if (st.entity_id.startsWith("zone.")) return "";
    // 区域：person 的 state 就是 zone 的 object_id
    if (state && state !== "not_home" && state !== "home") {
      const z = all.find((s) => s.entity_id === `zone.${state}`);
      if (z) return z.attributes?.friendly_name || state;
    }
    if (state === "home") return "在家";
    const kmh = Number(a.speed);
    if (Number.isFinite(kmh) && kmh > 0) {
      const v = a.speed_unit === "mph" ? `${Math.round(kmh)} mph` : `${Math.round(kmh * 3.6)} km/h`;
      return v;
    }
    const bat = Number(a.battery_level ?? a.battery);
    if (Number.isFinite(bat) && bat >= 0 && bat <= 100 && a.battery_level != null) return `电量 ${Math.round(bat)}%`;
    if (state === "not_home") {
      const rel = this._relTime(st.last_updated || st.last_changed);
      return rel ? `离家 · ${rel}` : "离家";
    }
    return this._relTime(st.last_updated || st.last_changed);
  }

  /* 区域配色：官方 zoneColor —— 家取主色，非被动区域按实体 id 取一个稳定调色板色 */
  _zoneColor(st) {
    const css = getComputedStyle(this);
    if (st.entity_id === "zone.home") {
      return css.getPropertyValue("--primary-color").trim() || "#03a9f4";
    }
    const palette = ["#5c6bc0", "#26a69a", "#8d6e63", "#7e57c2", "#42a5f5"];
    let h = 5381;
    for (let i = 0; i < st.entity_id.length; i++) h = (h * 33 + st.entity_id.charCodeAt(i)) % 2147483647;
    return palette[h % palette.length];
  }

  _zoneForState(st, zones) {
    if (!st || st.state === "not_home" || st.state === "unknown" || st.state === "unavailable") return null;
    const inZone = zones.find((z) => z.attributes?.persons?.includes(st.entity_id));
    if (inZone) return inZone;
    return zones.find((z) => (z.attributes?.friendly_name || "").toLowerCase() === String(st.state).toLowerCase()) || null;
  }

  _relTime(iso) {
    const t = typeof iso === "string" ? Date.parse(iso) : Number(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `${s} 秒前`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.round(h / 24)} 天前`;
  }

  /* 官方用 ha-state-icon 取实体图标；这里做轻量兜底，避免依赖内部组件 */
  _icon(st) {
    const a = st?.attributes || {};
    if (a.icon) return a.icon;
    const d = st?.entity_id?.split(".")[0];
    if (d === "person") return "mdi:account";
    if (d === "zone") return "mdi:map-marker-radius";
    if (d === "device_tracker") return "mdi:cellphone-marker";
    return "mdi:map-marker";
  }

  _initial(name) {
    const n = String(name || "?").trim();
    return n ? n.slice(0, 1).toUpperCase() : "?";
  }

  _renderList() {
    const listEl = this.shadowRoot.querySelector("[data-list]");
    const tabsEl = this.shadowRoot.querySelector(".cmc-tabs");
    if (!listEl) return;
    const g = this._listEntries();
    const zones = g.zones;
    const counts = { people: g.people.length, devices: g.devices.length, zones: zones.length };
    const tabs = this._tab || (counts.people ? "people" : counts.devices ? "devices" : "zones");
    this._tab = tabs;

    // Tab 药丸位置
    if (tabsEl) {
      const btns = [...tabsEl.querySelectorAll("[data-tab]")];
      const idx = btns.findIndex((b) => b.dataset.tab === tabs);
      btns.forEach((b, i) => {
        b.setAttribute("aria-selected", String(i === idx));
        b.disabled = !counts[b.dataset.tab];
      });
      const pill = tabsEl.querySelector(".pill");
      const active = btns[idx];
      if (pill && active) {
        tabsEl.style.setProperty("--n", String(btns.length));
        pill.style.left = `${active.offsetLeft}px`;
        pill.style.width = `${active.offsetWidth}px`;
      }
    }

    const rows = [];
    const mkRow = (st, name, sub, picture) => `
      <button class="cmc-item" data-entity="${st.entity_id}" title="${escapeAttr(name)}">
        <span class="cmc-item-av">${
          picture ? `<img src="${escapeAttr(picture)}" referrerpolicy="no-referrer" alt="">`
          : /^[a-z]+:/.test(this._icon(st)) ? `<ha-icon icon="${this._icon(st)}"></ha-icon>`
          : this._initial(name)}</span>
        <span class="cmc-item-tx">
          <span class="cmc-item-nm">${escapeHtml(name)}</span>
          <span class="cmc-item-sub">${escapeHtml(sub)}</span>
        </span>
      </button>`;

    const items = tabs === "people" ? g.people : tabs === "devices" ? g.devices : zones;
    items.forEach((st) => {
      const name = st.attributes.friendly_name || st.entity_id;
      if (tabs === "zones") {
        const n = Number(st.state);
        rows.push(mkRow(st, name, Number.isNaN(n) ? "" : `${n} 人在此`, null));
        return;
      }
      const zone = this._zoneForState(st, zones);
      let state;
      if (zone) state = `在 ${zone.attributes.friendly_name || "区域"}`;
      else if (st.state === "not_home") state = "离家";
      else if (st.state === "home") state = "在家";
      else state = st.state;
      const sub = `${state} · ${this._relTime(st.last_updated)}`;
      rows.push(mkRow(st, name, sub, st.attributes.entity_picture));
    });

    listEl.innerHTML = rows.length
      ? rows.join("")
      : `<div class="cmc-empty">暂无${{ people: "人员", devices: "设备", zones: "区域" }[tabs]}</div>`;

    listEl.querySelectorAll("[data-entity]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.dataset.entity;
        if (!this._hass?.states?.[id]) return;
        // 对齐官方：点列表项 = 聚焦飞行 + 选中；已选中时再点开 more-info
        if (this._engine?._selectedEntity === id) {
          this._openMoreInfo(id);
        } else {
          this.focusEntity(id);
        }
      });
    });
  }

  getCardSize() {
    // 全屏模式下高度由视口决定，给个大值免得 HA 按 360px 排格子
    if (this._layout === LAYOUT.FULL || this.classList.contains("cmc-bleed")) return 10;
    // 官方 hui-map-card 的算法：有宽高比时按比例折算成 50px 一格
    const r = this._parseAspect(this._config?.aspect_ratio);
    if (r) return 1 + Math.floor(((100 * r.h) / r.w) / 25) || 3;
    return Math.ceil((this._config?.height || 360) / 50) + 1;
  }

  /* 官方卡片 API：sections 视图的栅格尺寸。
     栅格 12 列、行高 56px；不给这个方法时卡片会占满整段且高度不可调 */
  getGridOptions() {
    if (this._layout === "panel" || this.classList.contains("cmc-bleed")) {
      return { columns: "full", rows: 8, min_columns: 6, min_rows: 2, max_rows: 20 };
    }
    const px = Number(this._config?.height) || 360;
    const rows = Math.min(20, Math.max(3, Math.round(px / 56)));
    return { columns: 12, rows, min_columns: 6, min_rows: 2, max_rows: 20 };
  }

  /* 兼容 HA 2024.x 的 sections 旧接口（2024.11+ 走 getGridOptions） */
  getLayoutOptions() {
    const g = this.getGridOptions();
    return {
      grid_columns: g.columns,
      grid_rows: g.rows,
      grid_min_columns: g.min_columns,
      grid_min_rows: g.min_rows,
    };
  }

  static async getConfigElement() {
    return document.createElement("ha-cn-map-card-editor");
  }
}

customElements.define("ha-cn-map-card", HaCnMapCard);

/* ==================================================================
 * 可视化编辑器
 * HA 约定：独立自定义元素，实现 hass / setConfig 两个 setter，
 * 变更时 fireEvent(card, "config-changed", { config })
 * ================================================================== */
const BASEMAP_OPTIONS = [
  { value: "amap", label: "高德地图（默认，免 Key）" },
  { value: "amap-satellite", label: "高德卫星影像" },
  { value: "tianditu", label: "天地图（需 Key）" },
  { value: "tianditu-satellite", label: "天地图卫星（需 Key）" },
  { value: "osm", label: "OpenStreetMap（海外）" },
];

const ENTITY_FILTER = [
  { key: "person.", label: "人员 person" },
  { key: "device_tracker.", label: "设备追踪 device_tracker" },
  { key: "zone.", label: "区域 zone" },
  { key: "geo_location.", label: "地理定位 geo_location" },
  { key: "", label: "全部带坐标实体" },
];

class HaCnMapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._built = false;
  }

  set hass(h) {
    this._hass = h;
    if (this._built) this._refreshEntityPicker();
  }

  setConfig(config) {
    this._config = { ...config };
    if (!this._built) this._build();
    this._syncForm();
  }

  /* ---- 结构：只建一次，之后只同步值，避免输入时丢焦点 ---- */
  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color,#e8e8e8); }
        .wrap { display:flex; flex-direction:column; gap:16px; padding:6px 2px 10px; }
        .row { display:flex; flex-direction:column; gap:6px; }
        .row.inline { flex-direction:row; align-items:center; justify-content:space-between; gap:12px; }
        .row.inline label.t { flex:1; }
        label.t {
          display:block; font-size:13px; font-weight:600; line-height:1.35;
          color:var(--primary-text-color,#e8e8e8);
        }
        .hint { font-size:12px; color:var(--secondary-text-color,#a0a0a0); line-height:1.45; }
        input[type=text], input[type=number], select {
          width:100%; box-sizing:border-box; padding:9px 10px; font-size:14px;
          border-radius:8px; border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121);
          font-family:inherit;
        }
        input::placeholder { color:var(--secondary-text-color,#8a8a8a); }
        input:focus, select:focus { outline:none; border-color:var(--primary-color,#03a9f4); }
        .switch { position:relative; width:44px; height:24px; flex:0 0 auto; }
        .switch input { opacity:0; width:0; height:0; }
        .slider {
          position:absolute; inset:0; border-radius:12px; cursor:pointer;
          background:var(--divider-color,#ccc); transition:background .15s;
        }
        .slider:before {
          content:""; position:absolute; width:18px; height:18px; left:3px; top:3px;
          background:#fff; border-radius:50%; transition:transform .15s;
        }
        .switch input:checked + .slider { background:var(--primary-color,#03a9f4); }
        .switch input:checked + .slider:before { transform:translateX(20px); }
        fieldset {
          border:1px solid var(--divider-color,rgba(255,255,255,.18)) !important;
          border-radius:10px; padding:14px 12px 12px; margin:0; min-inline-size:0;
        }
        legend {
          font-size:12px; padding:0 6px; color:var(--secondary-text-color,#a0a0a0);
          display:block;
        }
        .chips { display:flex; flex-wrap:wrap; gap:6px; }
        .chip {
          padding:5px 10px; border-radius:14px; font-size:12px; cursor:pointer;
          border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121);
        }
        .chip.on { background:var(--primary-color,#03a9f4); border-color:var(--primary-color,#03a9f4); color:#fff; }
        .ents { display:flex; flex-direction:column; gap:6px; }
        .ent {
          display:flex; align-items:center; gap:8px; padding:7px 9px; border-radius:8px;
          background:var(--secondary-background-color,#f5f5f5);
          border:1px solid var(--divider-color,#e0e0e0);
        }
        .ent .tag { font-size:11px; padding:2px 6px; border-radius:4px; background:var(--primary-color,#03a9f4); color:#fff; flex:0 0 auto; }
        .ent .name { flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ent .del { cursor:pointer; border:none; background:none; font-size:16px; color:var(--secondary-text-color,#727272); padding:0 4px; }
        .add { display:flex; gap:6px; }
        .add select { flex:1; }
        .addbtn {
          flex:0 0 auto; padding:0 14px; border-radius:8px; border:none; cursor:pointer;
          background:var(--primary-color,#03a9f4); color:#fff; font-size:14px;
        }
        .warn {
          display:flex; gap:8px; padding:10px; border-radius:8px; font-size:12px; line-height:1.5;
          background:rgba(255,152,0,.12); color:var(--primary-text-color,#212121);
          border:1px solid rgba(255,152,0,.4);
        }
      </style>
      <div class="wrap">
        <div class="row">
          <label class="t">标题（可留空）</label>
          <input type="text" data-k="title" placeholder="家人位置">
        </div>

        <div class="row">
          <label class="t">底图来源</label>
          <select data-k="basemap">
            ${BASEMAP_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
          </select>
          <div class="hint">高德免 Key，自动做 GCJ-02 纠偏；天地图需在 console.tianditu.gov.cn 申请免费 Key。</div>
        </div>

        <div class="row">
          <label class="t">主题</label>
          <select data-k="theme_mode">
            <option value="auto">跟随 Home Assistant（默认）</option>
            <option value="light">始终浅色</option>
            <option value="dark">始终深色</option>
          </select>
          <div class="hint">高德/天地图没有暗色瓦片，深色下用 CSS 滤镜近似；卫星影像不受影响。</div>
        </div>

        <div class="row" data-only="tianditu tianditu-satellite">
          <label class="t">天地图 Key</label>
          <input type="text" data-k="tianditu_key" placeholder="粘贴你的 tk">
          <div class="hint">免费额度约 1 万次/天。Key 在前端可见，注意配额。</div>
        </div>

        <fieldset>
          <legend>显示哪些标记</legend>
          <div class="row inline">
            <label class="t">自动显示全部带坐标实体</label>
            <label class="switch"><input type="checkbox" data-k="show_all"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">显示区域（家）</label>
            <label class="switch"><input type="checkbox" data-k="show_zones"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">区域半径圈（按 zone 的 radius 画圆）</label>
            <label class="switch"><input type="checkbox" data-k="show_zone_radius"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">去重：person 已覆盖的轨迹设备</label>
            <label class="switch"><input type="checkbox" data-k="dedupe_trackers"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">跳过实体注册表里隐藏的实体</label>
            <label class="switch"><input type="checkbox" data-k="respect_hidden"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">自动适配视野包含区域半径</label>
            <label class="switch"><input type="checkbox" data-k="fit_zones"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">标记聚合（相近的合并成一个气泡）</label>
            <label class="switch"><input type="checkbox" data-k="show_cluster"><span class="slider"></span></label>
          </div>
          <div class="row">
            <label class="t">标记标签内容</label>
            <select data-k="label_mode">
              <option value="name">实体名称（默认）</option>
              <option value="state">状态</option>
              <option value="none">不显示</option>
            </select>
            <div class="hint">逐实体可用 <code>label_mode: attribute</code> + <code>attribute: battery</code> 显示任意属性。</div>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">标记下方显示状态（在家 / 离线 / 速度）</label>
            <label class="switch"><input type="checkbox" data-k="show_status"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">GPS 精度圈（需要实体带 gps_accuracy）</label>
            <label class="switch"><input type="checkbox" data-k="show_accuracy"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">首次自动缩放到所有标记</label>
            <label class="switch"><input type="checkbox" data-k="fit_entities"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px" data-only="amap amap-satellite">
            <label class="t">实时路况（仅高德）</label>
            <label class="switch"><input type="checkbox" data-k="show_traffic"><span class="slider"></span></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>轨迹</legend>
          <div class="row">
            <label class="t">显示多长时间的历史轨迹</label>
            <select data-k="hours_to_show">
              <option value="0">关闭</option>
              <option value="1">1 小时</option>
              <option value="6">6 小时</option>
              <option value="12">12 小时</option>
              <option value="24">24 小时</option>
              <option value="48">48 小时</option>
              <option value="168">7 天</option>
            </select>
            <div class="hint">开启后按实体画折线，需要该实体有历史记录。</div>
          </div>
          <div class="row" data-hide-when="hours_to_show_zero">
            <label class="t">线宽</label>
            <input type="number" data-k="track_width" min="1" max="10" step="1" placeholder="3">
          </div>
        </fieldset>

        <div class="row" data-hide-when="show_all">
          <label class="t">指定实体</label>
          <div class="ents" data-ents></div>
          <div class="add">
            <select data-pickfilter>
              ${ENTITY_FILTER.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}
            </select>
            <select data-pickentity></select>
            <button class="addbtn" data-add>添加</button>
          </div>
        </div>

        <div class="row" data-hide-when="fit_entities">
          <label class="t">默认缩放级别</label>
          <input type="number" data-k="default_zoom" min="3" max="18" step="1">
        </div>

        <div class="row">
          <label class="t">显示模式</label>
          <select data-k="layout">
            <option value="auto">自动（面板视图铺满，其它固定高度）</option>
            <option value="full">总是铺满全屏</option>
            <option value="compact">总是固定高度</option>
          </select>
        </div>

        <div class="row">
          <label class="t">卡片高度（px）</label>
          <input type="number" data-k="height" min="180" max="900" step="10">
        </div>

        <div class="row">
          <label class="t">宽高比（可选，如 16:9）</label>
          <input type="text" data-k="aspect_ratio" placeholder="留空 = 用上面的高度">
          <div class="hint">填了宽高比就忽略「卡片高度」，地图按比例自适应；全屏态不生效。</div>
        </div>
      </div>
    `;

    const sr = this.shadowRoot;
    sr.querySelectorAll("[data-k]").forEach((el) => {
      const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => this._onChange(el));
    });
    sr.querySelector("[data-pickfilter]").addEventListener("change", () => this._refreshEntityPicker());
    sr.querySelector("[data-add]").addEventListener("click", () => this._addEntity());
  }

  _onChange(el) {
    const key = el.dataset.k;
    let value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "number") value = el.value === "" ? undefined : Number(el.value);
    else if (el.dataset.k === "hours_to_show") value = Number(el.value) || 0;
    else value = el.value;

    const cfg = { ...this._config };
    const keepZero = key === "hours_to_show";
    if (key === "layout" && value === "auto") delete cfg.layout;
    else if (value === "" || value === undefined || (value === 0 && !keepZero)) delete cfg[key];
    else cfg[key] = value;
    // 选了"总是铺满"就不该再被固定高度卡住
    if (key === "layout" && value === "full") delete cfg.height;

    // 底图切到需要 Key 的类型但没 Key 时提示，但不阻止保存
    this._config = cfg;
    this._applyVisibility();
    this._emit();
  }

  _addEntity() {
    const sel = this.shadowRoot.querySelector("[data-pickentity]");
    const id = sel.value;
    if (!id) return;
    const ents = Array.isArray(this._config.entities) ? [...this._config.entities] : [];
    if (ents.some((e) => (typeof e === "string" ? e : e.entity) === id)) return;
    ents.push({ entity: id });
    this._config = { ...this._config, entities: ents };
    this._renderEntities();
    this._emit();
  }

  _removeEntity(id) {
    const ents = (this._config.entities || []).filter(
      (e) => (typeof e === "string" ? e : e.entity) !== id
    );
    this._config = { ...this._config };
    if (ents.length) this._config.entities = ents;
    else delete this._config.entities;
    this._renderEntities();
    this._emit();
  }

  _refreshEntityPicker() {
    const sr = this.shadowRoot;
    if (!sr || !this._hass) return;
    const filter = sr.querySelector("[data-pickfilter]").value;
    const sel = sr.querySelector("[data-pickentity]");
    const states = this._hass.states || {};
    const opts = Object.keys(states)
      .filter((id) => {
        const a = states[id]?.attributes;
        if (a?.latitude == null || a?.longitude == null) return false;
        return filter ? id.startsWith(filter) : true;
      })
      .sort()
      .map((id) => {
        const n = states[id].attributes.friendly_name || id;
        return `<option value="${id}">${n} (${id})</option>`;
      });
    sel.innerHTML = opts.length ? opts.join("") : `<option value="">（没有匹配的实体）</option>`;
  }

  _renderEntities() {
    const host = this.shadowRoot.querySelector("[data-ents]");
    if (!host) return;
    const ents = this._config.entities || [];
    if (!ents.length) {
      host.innerHTML = `<div class="hint">还没有添加实体。也可以用上面的「自动显示全部」。</div>`;
      return;
    }
    host.innerHTML = ents
      .map((e) => {
        const id = typeof e === "string" ? e : e.entity;
        const st = this._hass?.states?.[id];
        const name = (typeof e === "object" && e.name) || st?.attributes?.friendly_name || id;
        const dom = id.split(".")[0];
        return `<div class="ent" data-id="${id}">
          <span class="tag">${dom}</span>
          <span class="name">${name}</span>
          <button class="del" title="移除">✕</button>
        </div>`;
      })
      .join("");
    host.querySelectorAll(".del").forEach((b) =>
      b.addEventListener("click", (ev) => {
        const id = ev.target.closest(".ent").dataset.id;
        this._removeEntity(id);
      })
    );
  }

  _applyVisibility() {
    const sr = this.shadowRoot;
    const bm = this._config.basemap || "amap";
    sr.querySelectorAll("[data-only]").forEach((el) => {
      const allow = el.dataset.only.split(" ");
      el.style.display = allow.includes(bm) ? "" : "none";
    });
    sr.querySelectorAll("[data-hide-when]").forEach((el) => {
      const k = el.dataset.hideWhen;
      el.style.display = this._config[k] ? "none" : "";
    });
  }

  _syncForm() {
    const sr = this.shadowRoot;
    const c = this._config;
    sr.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.type === "checkbox") {
        // fit_entities 默认为 true，其余默认为 false
        el.checked = c[k] === undefined ? ["fit_entities", "show_cluster", "show_status", "show_accuracy", "show_zone_radius", "dedupe_trackers", "respect_hidden"].includes(k) : !!c[k];
      } else if (el.tagName === "SELECT") {
        el.value = k === "layout" ? (c[k] || "auto")
          : k === "theme_mode" ? (c[k] || "auto")
          : k === "label_mode" ? (c[k] || "name")
          : String(c[k] === undefined ? 0 : c[k]);
      } else {
        el.value = c[k] === undefined ? (el.dataset.k === "height" ? 360 : "") : c[k];
      }
    });
    const h = sr.querySelector('[data-k="height"]');
    if (h && !h.value) h.value = 360;
    const z = sr.querySelector('[data-k="default_zoom"]');
    if (z && !z.value) z.value = 12;
    const bm = sr.querySelector('[data-k="basemap"]');
    if (bm) bm.value = c.basemap || "amap";
    this._applyVisibility();
    this._refreshEntityPicker();
    this._renderEntities();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("ha-cn-map-card-editor", HaCnMapCardEditor);

// 让 HA 识别为 Lovelace 卡片（提供编辑器占位）
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-cn-map-card",
  name: "中国地图卡片",
  description: "高德/天地图底图的 HA 地图卡片，免代理直连",
  preview: true,
  documentationURL: "https://github.com/RockJesus/ha-map-cn#readme",
});

console.info("%c ha-cn-map-card v1.1.4 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
