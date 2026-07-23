-- Keep Neovim visuals aligned with the terminal theme.
-- We rely on the terminal's 16-colour ANSI palette (set in Ghostty)
-- rather than 24-bit GUI colours, so a single theme change in the
-- terminal propagates everywhere.
vim.opt.termguicolors = false

-- noctu: maps all highlight groups to the 16 ANSI colours defined by
-- the terminal. Install with your preferred plugin manager, or drop
-- the single file into ~/.config/nvim/colors/.
-- https://github.com/noahfrederick/vim-noctu
vim.cmd.colorscheme("noctu")

-- Transparent backgrounds — let the terminal's background show through.
-- Only clear ctermbg on groups that don't use ctermfg=0 (black), since
-- that would be invisible against a dark terminal background.
vim.api.nvim_set_hl(0, "Normal", { ctermbg = "none" })
vim.api.nvim_set_hl(0, "NormalNC", { ctermbg = "none" })
vim.api.nvim_set_hl(0, "SignColumn", { ctermbg = "none" })
vim.api.nvim_set_hl(0, "EndOfBuffer", { ctermbg = "none" })


-- omp's "edit prompt in place" opens $EDITOR on a temp file named *.omp.md.
-- Drop straight into insert mode so you can type the prompt, then C-c C-c
-- writes and quits to send it back to the harness (mirroring the gitcommit
-- ftplugin). Scoped to *.omp.md so normal editing (incl. other markdown) is
-- untouched. Built-in ZZ / :x / :wq still work; :q! cancels unchanged.
vim.api.nvim_create_autocmd("BufEnter", {
  pattern = "*.omp.md",
  group = vim.api.nvim_create_augroup("OmpPrompt", { clear = true }),
  callback = function(args)
    vim.keymap.set("n", "<C-c><C-c>", "<cmd>wq<CR>", { buffer = args.buf, silent = true, desc = "Write and quit (send to harness)" })
    vim.keymap.set("i", "<C-c><C-c>", "<Esc><cmd>wq<CR>", { buffer = args.buf, silent = true, desc = "Write and quit (send to harness)" })
    -- Start in insert mode, but only on first entry to this buffer so
    -- escaping to normal (to navigate) and re-entering isn't forced back.
    if not vim.b[args.buf].omp_prompt_started then
      vim.b[args.buf].omp_prompt_started = true
      vim.schedule(vim.cmd.startinsert)
    end
  end,
})
