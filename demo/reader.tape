# Main README demo: open a document, move around, ask about a passage, follow up.
# Run through demo/record-demos.sh. Needs omp with this plugin installed, and a model
# configured: it makes real side-turn calls. Long waits for answers are hidden.

Output assets/reader.gif

Set Shell zsh
Set FontSize 15
Set Width 1500
Set Height 860
Set Padding 16
Set Framerate 25
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
Type "cd demo && clear && omp" Enter
Sleep 12s
Type "/read demo.md" Enter
Sleep 2.5s
Show

Sleep 1.5s
# Block by block, then jump a section.
Type "]"
Sleep 700ms
Type "]"
Sleep 700ms
Type "}"
Sleep 1.2s
# Select a few lines and use quick ask 6 ("intuitive").
Type "]"
Sleep 600ms
Type "v"
Sleep 400ms
Type "jj"
Sleep 1s
Type "6"
Sleep 7s
Hide
Sleep 24s
Show
Sleep 2.5s
Screenshot assets/thread.png

# A two-line follow-up: Alt+Enter adds a line (Shift+Enter too), Enter sends.
Type "So what exactly does git reflog record?"
Alt+Enter
Type "Keep it short."
Sleep 600ms
Enter
Sleep 5s
Hide
Sleep 18s
Show
Sleep 2s

# Out of the box, then the thread list.
Escape
Sleep 800ms
Escape
Sleep 2.5s

# Every key. (threads.png and help.png are cut from these last frames by record-demos.sh.)
Type "?"
Sleep 3s
Type "?"
Sleep 800ms
