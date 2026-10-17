# Session Lavender

An optional soft-lavender terminal theme with plum text, teal recording status
and warm orange for outside-scope paths. It defines the terminal's standard
16 ANSI colors; Session continues to use its existing palette.

The files contain colors only, with no font or shell settings. Importing a
theme is your choice; Session does not install or select it automatically.

## Apple Terminal

In Terminal, open **Settings → Profiles**. Drag
[Session Lavender.terminal](<Session Lavender.terminal>) into the profile list,
then open a window using that profile. See Apple's
[profile import guide](https://support.apple.com/en-lamr/guide/terminal/trml4299c696/mac).

## iTerm2

Open **Settings → Profiles → Colors → Color Presets → Import** and choose
[Session Lavender.itermcolors](<Session Lavender.itermcolors>). Select
**Session Lavender** from the presets menu. Enable **Use custom color for
selected text** for the preset's selection colors. Set **Faint text opacity**
to at least **80%** to keep Session's dim labels readable. See iTerm2's
[color settings guide](https://iterm2.com/documentation-preferences-profiles-colors.html).

## VS Code

Session inherits the integrated terminal's active color theme. Customize its
ANSI colors through `workbench.colorCustomizations`, as described in the
[VS Code terminal appearance guide](https://code.visualstudio.com/docs/terminal/appearance#_terminal-colors).
The `terminal.background` and `terminal.foreground` customizations set the
background and default text color; see the [terminal color reference](https://code.visualstudio.com/api/references/theme-color#integrated-terminal-colors).

## Readability

The stored text colors have at least 5.1:1 contrast against the lavender
background. The stored selection color pairs also pass 4.5:1. Terminals control
how they dim text; use the iTerm2 opacity setting above for readable labels.
`NO_COLOR=1` removes Session's ANSI styling while your chosen terminal
background remains.
