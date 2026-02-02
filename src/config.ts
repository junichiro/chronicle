export const SITE = {
  website: "https://chronicle.junichiro.co.uk/",
  author: "junichiro",
  profile: "https://github.com/junichiro",
  desc: "ソフトウェアエンジニアリング・設計原則・リファクタリングの実践記録。SOLID原則、Spring Boot、Rails、Python、TypeScriptの設計パターンとポーカー戦略。",
  title: "Chronicle",
  ogImage: "og-image.jpg",
  lightAndDarkMode: true,
  postPerIndex: 5,
  postPerPage: 10,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: false,
    text: "",
    url: "",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "ja",
  timezone: "Asia/Tokyo",
} as const;
