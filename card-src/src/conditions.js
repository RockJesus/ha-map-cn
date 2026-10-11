// 复刻官方卡片条件可见性判断（checkConditionsMet 的核心子集：state / numeric_state /
// and / or / not / time / user / screen / location；view_columns 依赖面板上下文，卡片场景不适用）

const statesEqual = (a, b) => String(a) === String(b);

const stateValue = (stateObj, attribute) =>
  attribute !== undefined && attribute !== null
    ? stateObj?.attributes?.[attribute]
    : stateObj?.state;

const checkStateCondition = (condition, hass) => {
  const stateObj = hass.states[condition.entity];
  const current = stateValue(stateObj, condition.attribute);
  if (condition.state !== undefined) {
    if (Array.isArray(condition.state)) {
      if (!condition.state.some((s) => statesEqual(s, current))) {
        return false;
      }
    } else if (!statesEqual(condition.state, current)) {
      return false;
    }
  }
  if (condition.state_not !== undefined) {
    if (Array.isArray(condition.state_not)) {
      if (condition.state_not.some((s) => statesEqual(s, current))) {
        return false;
      }
    } else if (statesEqual(condition.state_not, current)) {
      return false;
    }
  }
  return true;
};

const checkNumericCondition = (condition, hass) => {
  const stateObj = hass.states[condition.entity];
  if (!stateObj) {
    return false;
  }
  const value = Number(stateValue(stateObj, condition.attribute));
  if (Number.isNaN(value)) {
    return false;
  }
  if (condition.above !== undefined && !(value > Number(condition.above))) {
    return false;
  }
  if (condition.below !== undefined && !(value < Number(condition.below))) {
    return false;
  }
  return true;
};

const checkTimeCondition = (condition) => {
  const now = new Date();
  const toMinutes = (t) => {
    const m = String(t).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) {
      return 0;
    }
    return Number(m[1]) * 60 + Number(m[2]) + (Number(m[3]) || 0) / 60;
  };
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (condition.after && currentMinutes < toMinutes(condition.after)) {
    return false;
  }
  if (condition.before && currentMinutes > toMinutes(condition.before)) {
    return false;
  }
  if (condition.weekday) {
    const weekdays = Array.isArray(condition.weekday)
      ? condition.weekday
      : [condition.weekday];
    const today = now.getDay();
    if (!weekdays.some((w) => Number(w) === today)) {
      return false;
    }
  }
  return true;
};

const checkUserCondition = (condition, hass) =>
  !condition.users ||
  condition.users.length === 0 ||
  condition.users.includes(hass.user?.id);

const checkScreenCondition = (condition) => {
  if (!condition.media_query) {
    return true;
  }
  try {
    return window.matchMedia(condition.media_query).matches;
  } catch {
    return true;
  }
};

const checkLocationCondition = (condition, hass) => {
  const stateObj = hass.states[condition.entity];
  if (!stateObj) {
    return false;
  }
  if (condition.zone === undefined) {
    return true;
  }
  return statesEqual(stateObj.state, condition.zone);
};

export const checkConditionsMet = (conditions, hass) => {
  if (!conditions || !conditions.length) {
    return true;
  }
  return conditions.every((c) => {
    if (c && typeof c === "object" && "condition" in c) {
      switch (c.condition) {
        case "time":
          return checkTimeCondition(c);
        case "screen":
          return checkScreenCondition(c);
        case "user":
          return checkUserCondition(c, hass);
        case "location":
          return checkLocationCondition(c, hass);
        case "numeric_state":
          return checkNumericCondition(c, hass);
        case "and":
          return checkConditionsMet(c.conditions, hass);
        case "or":
          return c.conditions.some((cc) =>
            checkConditionsMet([cc], hass)
          );
        case "not":
          return !checkConditionsMet(c.conditions, hass);
        default:
          return checkStateCondition(c, hass);
      }
    }
    return checkStateCondition(c, hass);
  });
};

export const addEntityToCondition = (condition, entityId) => {
  const copy = { ...condition };
  if (copy.condition === "and" || copy.condition === "or" || copy.condition === "not") {
    copy.conditions = (copy.conditions || []).map((c) =>
      addEntityToCondition(c, entityId)
    );
  } else if (!copy.entity) {
    copy.entity = entityId;
  }
  return copy;
};
