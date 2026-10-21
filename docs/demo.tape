# Run from the repository root with Session installed and no active session.
# This records real output; a pause alone does not create file changes.
Output docs/demo.gif

Set Width 1200
Set Height 700
Set FontSize 22
Set Theme "Dracula"
Set TypingSpeed 50ms

Type 'session start "add rate limiting" --scope src'
Enter
Sleep 4s

Ctrl+l
Type 'session stop'
Enter
Sleep 5s

Ctrl+l
Type 'session pr --card'
Enter
Sleep 7s
