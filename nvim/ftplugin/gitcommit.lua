-- Save and close commit messages with C-c C-c.
vim.keymap.set("n", "<C-c><C-c>", "<cmd>wq<CR>", {
  buffer = true,
  silent = true,
  desc = "Write and quit commit message",
})

vim.keymap.set("i", "<C-c><C-c>", "<Esc><cmd>wq<CR>", {
  buffer = true,
  silent = true,
  desc = "Write and quit commit message",
})
