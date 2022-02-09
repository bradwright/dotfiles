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
      }
    ]
  }
  