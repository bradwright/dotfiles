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
