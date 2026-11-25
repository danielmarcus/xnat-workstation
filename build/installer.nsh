; Included by electron-builder's NSIS installer (the default nsis.include, build/installer.nsh).
; Registers xnat-workstation:// links (docs/open-from-link.md) for the installed app; the app
; also registers itself at start-up (app.setAsDefaultProtocolClient), which covers the portable
; build. Same command line as Electron writes: the link is the only argument.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\xnat-workstation" "" "URL:XNAT Workstation link"
  WriteRegStr SHELL_CONTEXT "Software\Classes\xnat-workstation" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\xnat-workstation\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\xnat-workstation\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\xnat-workstation"
  ${endIf}
!macroend
