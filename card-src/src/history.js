// history/stream 订阅：复刻官方 subscribeHistoryStatesTimeWindow 的协议参数
// 返回取消函数；数据格式：Record<entity_id, Array<{s,a,lu,lc}>>

export const subscribeHistory = (
  hass,
  entityIds,
  hoursToShow,
  onChange
) => {
  if (!entityIds.length || !hoursToShow) {
    return Promise.resolve(() => Promise.resolve());
  }
  return hass.connection.subscribeMessage(
    (message) => {
      if (message && message.states) {
        onChange(message.states);
      }
    },
    {
      type: "history/stream",
      entity_ids: entityIds,
      start_time: new Date(
        new Date().getTime() - 60 * 60 * hoursToShow * 1000
      ).toISOString(),
      minimal_response: false,
      significant_changes_only: false,
      no_attributes: false,
    }
  );
};

/** 从历史状态里提取有效轨迹点（含经纬度的状态变化），返回 [{lat,lng,lu}] */
export const extractPathPoints = (states) => {
  if (!states || !states.length) {
    return [];
  }
  const points = [];
  for (const state of states) {
    const lat = state.a?.latitude;
    const lng = state.a?.longitude;
    if (typeof lat === "number" && typeof lng === "number" && lat && lng) {
      points.push({ lat, lng, lu: state.lu * 1000 });
    }
  }
  return points;
};
