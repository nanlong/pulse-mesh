type UiText = {
  home: string
  archive: string
  topics: string
  about: string
  rss: string
  newsletter: string
  sponsor: string
  editorialPolicy: string
  corrections: string
  privacy: string
  disclosure: string
  contact: string
  readMore: string
  latest: string
  selectedItems: string
  allArticles: string
  relatedArticles: string
  source: string
  publishedBy: string
  updatedAt: string
  noArticles: string
  viewArchive: string
}

const zh: UiText = {
  home: '首页',
  archive: '归档',
  topics: '专题',
  about: '关于',
  rss: 'RSS',
  newsletter: '订阅更新',
  sponsor: '合作',
  editorialPolicy: '编辑准则',
  corrections: '纠错',
  privacy: '隐私',
  disclosure: 'AI 与利益披露',
  contact: '联系',
  readMore: '阅读全文',
  latest: '最新内容',
  selectedItems: '条精选内容',
  allArticles: '全部文章',
  relatedArticles: '相关内容',
  source: '来源',
  publishedBy: '发布者',
  updatedAt: '发布时间',
  noArticles: '暂无内容。',
  viewArchive: '查看全部归档',
}

const en: UiText = {
  home: 'Home',
  archive: 'Archive',
  topics: 'Topics',
  about: 'About',
  rss: 'RSS',
  newsletter: 'Subscribe',
  sponsor: 'Partner',
  editorialPolicy: 'Editorial policy',
  corrections: 'Corrections',
  privacy: 'Privacy',
  disclosure: 'AI and disclosures',
  contact: 'Contact',
  readMore: 'Read article',
  latest: 'Latest',
  selectedItems: 'curated items',
  allArticles: 'All articles',
  relatedArticles: 'Related articles',
  source: 'Sources',
  publishedBy: 'Published by',
  updatedAt: 'Published',
  noArticles: 'No articles yet.',
  viewArchive: 'View full archive',
}

export function uiFor(locale: string): UiText {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
