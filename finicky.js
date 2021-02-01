module.exports = {
    defaultBrowser: "Choosy",
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
        match: ({ url }) => url.host.startsWith("www.notion.so"),
        url: ({ url }) => ({
          ...url,
          protocol: 'notion',
          host: ''
        }),
        browser: 'Notion',
      }
    ]
  }
  