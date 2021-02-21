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
      }
    ]
  }
  