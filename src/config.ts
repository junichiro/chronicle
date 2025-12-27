export const SITE = {
  website: "https://chronicle-969.pages.dev/",
  author: "junichiro",
  profile: "https://github.com/junichiro",
  desc: "技術と日常の記録",
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
