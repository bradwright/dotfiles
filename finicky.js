module.exports = {
    defaultBrowser: "Choosy",
    options: {
        // hide MenuBar icon
      hideIcon: true
    },
    handlers: [
      {
        match: ({ url }) => url.host.startsWith("mail.superhuman.com"),
        url: ({ url }) => ({
            ...url,
          protocol: 'superhuman',
            host: '',
            hash: ''
        }),
        browser: 'Superhuman',
      },
      {
        match: ({ url }) => url.host.startsWith("www.notion.so") && url.pathname.startsWith('/bradwright'),
        url: ({ url }) => ({
            ...url,
          protocol: 'notion'
        }),
        browser: 'Notion',
      }
    ]
  }
