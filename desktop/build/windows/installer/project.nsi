Unicode true

####
## VaultDock desktop installer (NSIS). Built by `wails build -nsis`, which
## generates wails_tools.nsh from wails.json. Per-user install: no
## administrator rights are needed and the app runs as the signed-in user.
####
!define REQUEST_EXECUTION_LEVEL "user"
!define WAILS_INSTALL_SCOPE "user"

!include "wails_tools.nsh"

VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

ManifestDPIAware true

!include "MUI.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start VaultDock"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

## Code signing hooks (uncomment and configure signtool for releases):
#!uninstfinalize 'signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 "%1"'
#!finalize 'signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${INFO_PRODUCTVERSION}-${ARCH}-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
ShowInstDetails show

# Stop a running instance so its files can be replaced (upgrade in place).
# Settings, the device key and sync state live in %APPDATA%\VaultDock and
# are kept, so an upgrade continues exactly where it left off.
!macro StopRunningApp
    nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${PRODUCT_EXECUTABLE}" /F'
    Pop $0
    Sleep 800
!macroend

# Automatic updates run this installer as: setup.exe /S /RELAUNCH /D=<dir>
# It then installs silently into the existing folder and starts the app again.
Var Relaunch

Function .onInit
   !insertmacro wails.checkArchitecture
   StrCpy $Relaunch "0"
   ${GetParameters} $R0
   ClearErrors
   ${GetOptions} $R0 "/RELAUNCH" $R1
   ${IfNot} ${Errors}
       StrCpy $Relaunch "1"
   ${EndIf}
FunctionEnd

Function .onInstSuccess
   ${If} $Relaunch == "1"
       Exec '"$INSTDIR\${PRODUCT_EXECUTABLE}" --updated'
   ${EndIf}
FunctionEnd

Section
    !insertmacro wails.setShellContext
    !insertmacro StopRunningApp
    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    # Updates keep the user's choice: a removed desktop shortcut is not recreated.
    ${If} $Relaunch != "1"
        CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    ${EndIf}

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext
    !insertmacro StopRunningApp

    # Remove start-with-Windows entry.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VaultDock"

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # WebView2 cache
    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    # Local settings and sync state are only removed on explicit request.
    # Files on this PC and files stored in VaultDock are never touched.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove VaultDock settings, the device key and local sync history from this PC?$\r$\n$\r$\nYour own files and everything stored on your VaultDock server are NOT affected." /SD IDNO IDNO keepdata
        RMDir /r "$APPDATA\VaultDock"
        RMDir /r "$LOCALAPPDATA\VaultDock"
    keepdata:

    !insertmacro wails.deleteUninstaller
SectionEnd
