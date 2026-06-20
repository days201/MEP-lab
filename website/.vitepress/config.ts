import { defineConfig } from 'vitepress';

const SITE_ORIGIN = 'https://days201.github.io';
const SITE_BASE = '/mep-lab/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og-image.png`;
const GITHUB_URL = 'https://github.com/days201/MEP-lab';
const RELEASES_URL = `${GITHUB_URL}/releases`;
const DISCORD_URL = 'https://discord.gg/pynjtQDf';
const PROJECT_DESCRIPTION =
  'Open-source AI agent desktop app for Windows and macOS with one-click installation, sandbox isolation, multi-model support, built-in Skills, MCP integration, GUI automation, and remote control.';
const FEATURE_LIST = [
  'One-click installers for Windows and macOS',
  'Multi-model support for Claude, GPT, Gemini, DeepSeek, GLM, MiniMax, Kimi, and OpenAI-compatible APIs',
  'VM sandbox isolation with WSL2 on Windows and Lima on macOS',
  'Built-in Skills for PPTX, DOCX, XLSX, and PDF workflows',
  'MCP integration for browsers, Notion, and other desktop tools',
  'GUI automation through computer use',
  'Remote control through Feishu (Lark) and Slack',
  'Local-first operation with no MEP Lab telemetry',
];
const FAQ_ITEMS = [
  {
    question: 'What is MEP Lab?',
    answer:
      'MEP Lab is a free, open-source AI agent desktop application for Windows and macOS. It wraps AI models into a user-friendly GUI with one-click installation.',
  },
  {
    question: 'What AI models are supported?',
    answer:
      'MEP Lab supports Claude through Anthropic or OpenRouter, OpenAI-compatible APIs, and models such as Gemini, DeepSeek, GLM, MiniMax, and Kimi.',
  },
  {
    question: 'Is MEP Lab free?',
    answer:
      'Yes. MEP Lab is free and open-source under the MIT license. Users pay only for usage from their chosen AI model provider.',
  },
  {
    question: 'How does sandbox isolation work?',
    answer:
      'MEP Lab uses WSL2 on Windows and Lima on macOS to run AI-executed commands inside an isolated Linux VM when available, with path-based workspace restrictions as a baseline.',
  },
  {
    question: 'Does MEP Lab send data to its own servers?',
    answer:
      'No. MEP Lab runs locally. The only external communication is with the AI model API configured by the user.',
  },
];
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#organization`,
      name: 'days201',
      url: 'https://github.com/days201',
      sameAs: ['https://github.com/days201', DISCORD_URL],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      name: 'MEP Lab',
      url: SITE_URL,
      inLanguage: ['en', 'zh-CN'],
      publisher: { '@id': `${SITE_URL}#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}#software`,
      name: 'MEP Lab',
      description: PROJECT_DESCRIPTION,
      url: SITE_URL,
      image: OG_IMAGE,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: ['Windows', 'macOS'],
      codeRepository: GITHUB_URL,
      downloadUrl: RELEASES_URL,
      license: 'https://opensource.org/licenses/MIT',
      softwareVersion: '3.3.0',
      isAccessibleForFree: true,
      featureList: FEATURE_LIST,
      author: { '@id': `${SITE_URL}#organization` },
      publisher: { '@id': `${SITE_URL}#organization` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}#faq`,
      url: SITE_URL,
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    },
  ],
};

export default defineConfig({
  title: 'MEP Lab',
  description:
    'Open-source AI agent desktop app for Windows & macOS — one-click install Claude Code, MCP tools, and Skills with sandbox isolation and multi-model support.',

  base: SITE_BASE,

  head: [
    ['link', { rel: 'icon', href: '/mep-lab/logo.png' }],
    [
      'link',
      { rel: 'alternate', type: 'text/plain', title: 'llms.txt', href: '/mep-lab/llms.txt' },
    ],
    [
      'link',
      {
        rel: 'alternate',
        type: 'text/markdown',
        title: 'Full AI context',
        href: '/mep-lab/llms-full.txt',
      },
    ],
    [
      'link',
      {
        rel: 'alternate',
        type: 'application/json',
        title: 'MEP Lab project metadata',
        href: '/mep-lab/project.json',
      },
    ],
    ['meta', { name: 'application-name', content: 'MEP Lab' }],
    [
      'meta',
      {
        name: 'robots',
        content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      },
    ],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'MEP Lab — Open-Source AI Agent Desktop App' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Free, open-source AI agent desktop app for Windows & macOS. One-click install with sandbox isolation, multi-model support, and built-in Skills.',
      },
    ],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'MEP Lab — Open-Source AI Agent Desktop App' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Free AI agent desktop app for Windows & macOS. One-click install, multi-model, sandbox isolation.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    // SEO
    [
      'meta',
      {
        name: 'keywords',
        content:
          'MEP Lab, AI agent, desktop app, Claude Code, MCP, Skills, sandbox, open source, Windows, macOS, multi-model, PPTX generator, Feishu, Slack',
      },
    ],
    // Schema.org JSON-LD
    ['script', { type: 'application/ld+json' }, JSON.stringify(STRUCTURED_DATA)],
  ],

  sitemap: { hostname: SITE_URL },

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Download', link: 'https://github.com/days201/MEP-lab/releases' },
      { text: 'GitHub', link: 'https://github.com/days201/MEP-lab' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/days201/MEP-lab' },
      { icon: 'discord', link: 'https://discord.gg/pynjtQDf' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2025-present days201',
    },

    search: { provider: 'local' },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      description: '免费开源的 AI 智能助手桌面应用，支持 Windows 和 macOS 一键安装。',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '下载', link: 'https://github.com/days201/MEP-lab/releases' },
          { text: 'GitHub', link: 'https://github.com/days201/MEP-lab' },
        ],
        footer: {
          message: '基于 MIT 协议开源。',
          copyright: '© 2025-present days201',
        },
      },
    },
  },
});
