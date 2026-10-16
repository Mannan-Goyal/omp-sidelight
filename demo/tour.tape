# First-run demo: the tour offer, then the first steps of the guided tour.
# Run from the repository root with the tour state cleared: just-once offer lives in
# ~/.omp/agent/explain-reader/tour.json (record-demos.sh handles this).

Output assets/tour.gif

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
Show

Type "/read demo.md"
Sleep 600ms
Enter
Sleep 3s
# Accept the tour.
Enter
Sleep 3s
Type "]"
Sleep 1.8s
Type "}"
Sleep 1.8s
Type "v"
Sleep 400ms
Type "jj"
Sleep 1.8s
Type "6"
Sleep 4s
