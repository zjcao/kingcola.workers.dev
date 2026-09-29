/**
 * 初始内容种子数据。
 *
 * 生产环境的正式数据一律存 D1；本文件仅用于：
 *   1) D1 为空时由后台「初始化演示数据」按钮一次性写入；
 *   2) 前端在 API 不可达时作为只读兜底，避免白屏。
 * 内容均为占位示例，可整体替换。
 */

import type { Member, NewsItem, Project, Slide } from './types'

export const seedSlides: Slide[] = [
  {
    id: 's-1',
    type: 'text',
    kicker: 'SHIGUANG STUDIO · EST. 2019',
    title: '把想法写成代码',
    subtitle:
      '我们是一个由学生组成的计算机工作室，做 Web、移动端与 AI 应用。在这里，想法会被写成代码，代码会变成真正能用的产品。',
    ctaText: '看看我们的项目',
    ctaPage: 'projects',
    sortOrder: 1,
  },
  {
    id: 's-2',
    type: 'text',
    kicker: 'PROJECTS · BUILT BY STUDENTS',
    title: '做真正能用的产品',
    subtitle:
      '校园课表助手、智能问答知识库、图书馆座位预约系统……工作室的每个项目都从真实需求出发，服务真实的用户。',
    ctaText: '浏览项目',
    ctaPage: 'projects',
    sortOrder: 2,
  },
  {
    id: 's-3',
    type: 'text',
    kicker: 'JOIN US · FALL 2026',
    title: '2026 秋季招新进行中',
    subtitle:
      '无论你想写前端、做后端、搞算法还是做设计，这里都有真实的项目等着你。零基础但学习意愿强的同学同样欢迎。',
    ctaText: '立即报名',
    ctaPage: 'join',
    sortOrder: 3,
  },
]

/** 种子里允许省略的字段：读库时它们一定存在（见 `worker/lib/repo.ts` 的整行读写口径） */
type SeedMember = Omit<Member, 'avatarUrl' | 'destination' | 'homepageUrl' | 'sortOrder'> &
  Partial<Pick<Member, 'avatarUrl' | 'destination' | 'homepageUrl' | 'sortOrder'>>

const rawSeedMembers: SeedMember[] = [
  {
    id: 'pi-1',
    name: '陈默',
    nameEn: 'Mo Chen',
    title: '指导老师',
    direction: '软件工程 · 人工智能应用',
    email: 'chenmo@example.edu.cn',
    joinYear: '2019',
    status: 'current',
    isPI: true,
    bio: '工作室指导老师，主要研究方向为软件工程与人工智能应用，指导学生团队完成多个校企合作项目与学科竞赛，注重在真实项目中培养学生的工程能力。',
    sortOrder: 0,
  },
  {
    id: 'm-1',
    name: '林一舟',
    nameEn: 'Yizhou Lin',
    title: '前端开发',
    direction: 'Web 前端 · 可视化',
    email: '',
    joinYear: '2024',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 10,
  },
  {
    id: 'm-2',
    name: '赵之衡',
    nameEn: 'Zhiheng Zhao',
    title: '后端开发',
    direction: '服务端架构 · 数据库',
    email: '',
    joinYear: '2023',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 11,
  },
  {
    id: 'm-3',
    name: '苏晓',
    nameEn: 'Xiao Su',
    title: '算法工程师',
    direction: '深度学习 · NLP',
    email: '',
    joinYear: '2024',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 12,
  },
  {
    id: 'm-4',
    name: '何田',
    nameEn: 'Tian He',
    title: '移动端开发',
    direction: 'Android / 跨端应用',
    email: '',
    joinYear: '2024',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 13,
  },
  {
    id: 'm-5',
    name: '高语',
    nameEn: 'Yu Gao',
    title: 'UI 设计',
    direction: '界面设计 · 交互原型',
    email: '',
    joinYear: '2025',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 14,
  },
  {
    id: 'm-6',
    name: '许诺',
    nameEn: 'Nuo Xu',
    title: '后端开发',
    direction: '云原生 · DevOps',
    email: '',
    joinYear: '2025',
    status: 'current',
    isPI: false,
    bio: '',
    sortOrder: 15,
  },
  {
    id: 'a-1',
    name: '王梓',
    nameEn: 'Zi Wang',
    title: '前端开发',
    direction: '',
    destination: '某互联网大厂 前端工程师',
    email: '',
    joinYear: '2021',
    status: 'alumni',
    isPI: false,
    bio: '',
    sortOrder: 20,
  },
  {
    id: 'a-2',
    name: '杜若飞',
    nameEn: 'Ruofei Du',
    title: '算法工程师',
    direction: '',
    destination: '本校读研深造',
    email: '',
    joinYear: '2022',
    status: 'alumni',
    isPI: false,
    bio: '',
    sortOrder: 21,
  },
]

/** 补齐头像 / 毕业去向 / 个人主页 / 排序权重，让种子成员的形状与 D1 读出来的记录完全一致 */
export const seedMembers: Member[] = rawSeedMembers.map(
  ({ avatarUrl, destination, homepageUrl, sortOrder, ...rest }) => ({
    avatarUrl: avatarUrl ?? '',
    destination: destination ?? '',
    homepageUrl: homepageUrl ?? '',
    sortOrder: sortOrder ?? 0,
    ...rest,
  }),
)

/** 项目主键由数据库自增，种子数据不带 id */
export const seedProjects: Omit<Project, 'id'>[] = [
  {
    name: '校园课表助手',
    tagline: '面向本校学生的课表与空教室查询小程序',
    description:
      '对接学校教务数据，提供课表同步、空教室查询、考试倒计时等功能。累计服务校内 5000+ 用户，是工作室第一个正式上线运营的产品。',
    tags: ['微信小程序', 'Node.js', 'MySQL'],
    honor: '',
    featured: true,
    year: '2025',
    link: '',
  },
  {
    name: '智能问答知识库',
    tagline: '基于大模型的院系知识问答系统',
    description:
      '结合 RAG 检索增强生成技术，将学院通知、培养方案、常见问题等文档构建为知识库，为新生提供 7×24 小时智能问答服务。',
    tags: ['LLM', 'RAG', 'Python', 'Vue'],
    honor: '2026 年大学生计算机设计大赛 省级一等奖',
    featured: true,
    year: '2026',
    link: '',
  },
  {
    name: '工作室管理平台',
    tagline: '本网站：成员、项目、新闻与招新一体化管理',
    description:
      '工作室的对外门户与内部管理工具，支持成员信息维护、新闻发布、项目展示与招新报名收集，由工作室成员自主设计开发。',
    tags: ['React', 'TypeScript', 'Tailwind'],
    honor: '',
    featured: true,
    year: '2026',
    link: '',
  },
  {
    name: '图书馆座位预约系统',
    tagline: '与校图书馆合作的座位预约与签到系统',
    description:
      '提供座位实时状态展示、在线预约、扫码签到与违约管理功能，上线后图书馆座位利用率显著提升。',
    tags: ['Java', 'Spring Boot', 'Android'],
    honor: '校图书馆优秀合作项目',
    featured: false,
    year: '2024',
    link: '',
  },
]

export const seedNews: NewsItem[] = [
  {
    id: 'n-1',
    title: '工作室在 2026 年大学生计算机设计大赛中获省级一等奖',
    category: '竞赛获奖',
    date: '2026-08-20',
    summary:
      '由工作室成员组成的参赛队伍凭借「智能问答知识库」项目，获得大学生计算机设计大赛省级一等奖。',
    content:
      '在刚刚结束的 2026 年大学生计算机设计大赛省赛中，由工作室成员苏晓、林一舟等组成的参赛队伍，凭借「智能问答知识库」项目获得省级一等奖，并将代表学校参加国赛。\n\n该项目基于 RAG 技术构建院系知识问答系统，兼具实用性与技术创新性，获得了评委的一致好评。',
    pinned: true,
    sortOrder: 1,
  },
  {
    id: 'n-2',
    title: '2026 年秋季招新启动，欢迎对开发感兴趣的同学报名',
    category: '通知公告',
    date: '2026-09-01',
    summary:
      '工作室 2026 年秋季招新正式开始，面向全校招收对前后端开发、算法、设计感兴趣的同学。',
    content:
      '工作室 2026 年秋季招新正式启动。我们欢迎对 Web 开发、移动开发、人工智能、UI 设计等方向感兴趣的同学加入。\n\n报名请通过本站「加入我们」页面提交报名信息，工作室将在收到报名后一周内安排面谈。零基础但学习意愿强的同学同样欢迎！',
    pinned: true,
    sortOrder: 2,
  },
  {
    id: 'n-3',
    title: '技术分享会：大模型应用开发入门',
    category: '团队活动',
    date: '2026-06-14',
    summary:
      '工作室举办内部技术分享会，由算法组同学主讲大模型应用开发的基本流程与工程实践。',
    content:
      '6 月 14 日晚，工作室在实验室举办技术分享会。算法组苏晓同学以「大模型应用开发入门」为主题，介绍了 Prompt 工程、RAG 架构与 Agent 的基本概念，并现场演示了一个知识库问答 Demo 的搭建过程。',
    pinned: false,
    sortOrder: 3,
  },
  {
    id: 'n-4',
    title: '校园课表助手用户突破 5000',
    category: '通知公告',
    date: '2026-05-08',
    summary: '工作室自研产品「校园课表助手」累计用户突破 5000 人。',
    content:
      '工作室自研产品「校园课表助手」上线一年后，累计用户突破 5000 人。项目组将根据用户反馈持续迭代，下一版本计划加入成绩查询与课程提醒功能。',
    pinned: false,
    sortOrder: 4,
  },
]

export const SEED_BY_RESOURCE = {
  members: seedMembers,
  projects: seedProjects,
  news: seedNews,
  slides: seedSlides,
} as const
