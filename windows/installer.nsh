; Zusätzliche Startmenü-Verknüpfung „EK-Service aktualisieren“ (führt die mitgelieferte Update-Datei aus)
!macro customInstall
  CreateShortCut "$SMPROGRAMS\EK-Service aktualisieren.lnk" "$INSTDIR\EK-Service-Update.bat" "" "$INSTDIR\EK-Service.exe" 0
!macroend
!macro customUnInstall
  Delete "$SMPROGRAMS\EK-Service aktualisieren.lnk"
!macroend
