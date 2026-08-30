// 生成产物（scripts/sync-creator.mjs，源=config/theme.json）——勿手改
export const THEME = {
  "version": 1,
  "sourceDoc": "docs/UI-UX设计规范.md §二",
  "color": {
    "bg_night": "#0B1020",
    "bg_dawn": "#141A2E",
    "alert_blood": "#C0392B",
    "gold_primary": "#FFD700",
    "gold_deep": "#B8860B",
    "panel": "#1A2238",
    "panel_stroke": "#2A3555",
    "text_primary": "#E8E8F0",
    "text_secondary": "#8892B0",
    "success": "#7FFF9F",
    "danger": "#FF6B6B",
    "panic": "#9B59B6"
  },
  "typography": {
    "family_cn": "SourceHanSansCN-Bold",
    "family_num": "BebasNeue",
    "h1": 32,
    "h2": 26,
    "body": 24,
    "caption": 18
  },
  "space": {
    "xs": 8,
    "s": 16,
    "m": 24,
    "l": 32
  },
  "radius": {
    "panel": 16,
    "btn": 12,
    "chip": 8
  },
  "motion": {
    "fast": {
      "dur": 150,
      "ease": "easeOutQuad"
    },
    "normal": {
      "dur": 300,
      "ease": "easeOutCubic"
    },
    "rain": {
      "dur": 500,
      "ease": "easeOutBack"
    },
    "threat": {
      "dur": 300,
      "ease": "easeInQuad",
      "repeat": 2
    },
    "dissolve": {
      "dur": 800,
      "ease": "linear"
    },
    "counter": {
      "dur": 800,
      "ease": "easeOutCubic"
    },
    "stagger": {
      "dur": 60,
      "ease": "linear"
    }
  }
} as const
