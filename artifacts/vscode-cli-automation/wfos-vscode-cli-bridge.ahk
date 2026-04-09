#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

CoordMode "Mouse", "Screen"
CoordMode "ToolTip", "Screen"

global APP_TITLE := "Workflow OS VS Code CLI Bridge"
global CONFIG_PATH := A_ScriptDir . "\automation.ini"
global PROMPTS_DIR := A_ScriptDir . "\prompts"
global STATE_PATH := A_ScriptDir . "\automation-state.ini"
global CONFIG_MTIME := ""
global WORKERS := []
global g_running := false

LoadConfig()
SetTimer(WatchConfig, 1000)
SetTimer(Scheduler, 250)
TrayTip(APP_TITLE, "F8 시작 · F9 중지 · F7 좌표 캡처 · F6 프롬프트만 · F10 Enter만 · F11 둘 다", 2)

F8::StartAutomation()
F9::StopAutomation()
F7::CaptureWorkerTargets()
F6::SendAllPromptsNow()
F10::SendAllEntersNow()
F11::SendAllPromptsAndEntersNow()

ConfigMtime() {
    return FileExist(CONFIG_PATH) ? FileGetTime(CONFIG_PATH, "M") : ""
}

LoadConfig() {
    global CONFIG_MTIME, WORKERS, g_running
    if !FileExist(CONFIG_PATH) {
        WORKERS := []
        g_running := false
        return
    }
    CONFIG_MTIME := ConfigMtime()
    enabled := IniRead(CONFIG_PATH, "general", "enabled", "0")
    cycleMinutes := Max(1, Round(0 + IniRead(CONFIG_PATH, "general", "cycle_minutes", "30")))
    enterSeconds := Max(1, Round(0 + IniRead(CONFIG_PATH, "general", "enter_seconds", "10")))
    workerCount := Max(0, Round(0 + IniRead(CONFIG_PATH, "general", "worker_count", "0")))
    nextWorkers := []
    Loop workerCount {
        section := "worker_" . A_Index
        promptFile := IniRead(CONFIG_PATH, section, "prompt_file", "")
        promptPath := PROMPTS_DIR . "\" . promptFile
        promptText := FileExist(promptPath) ? FileRead(promptPath, "UTF-8") : ""
        nextWorkers.Push(Map(
            "name", IniRead(CONFIG_PATH, section, "name", "Worker " . A_Index),
            "plan", IniRead(CONFIG_PATH, section, "plan_id", ""),
            "role", IniRead(CONFIG_PATH, section, "role_label", ""),
            "prompt", promptText,
            "cycleMinutes", cycleMinutes,
            "enterSeconds", enterSeconds,
            "x", Round(0 + IniRead(STATE_PATH, section, "x", "-1")),
            "y", Round(0 + IniRead(STATE_PATH, section, "y", "-1")),
            "nextEnterTick", 0,
            "nextPromptTick", 0
        ))
    }
    WORKERS := nextWorkers
    g_running := ((enabled = "1") && (WORKERS.Length > 0))
    if g_running && !EnsureWorkerTargets()
        CaptureWorkerTargets()
    if g_running
        ResetSchedules()
}

WatchConfig() {
    global CONFIG_MTIME
    current := ConfigMtime()
    if current != CONFIG_MTIME
        LoadConfig()
}

ResetSchedules() {
    global WORKERS
    now := A_TickCount
    for index, worker in WORKERS {
        worker["nextEnterTick"] := now + (worker["enterSeconds"] * 1000)
        worker["nextPromptTick"] := now + (worker["cycleMinutes"] * 60000)
        WORKERS[index] := worker
    }
}

EnsureWorkerTargets() {
    global WORKERS
    for _, worker in WORKERS {
        if worker["x"] < 0 || worker["y"] < 0
            return false
    }
    return true
}

FindVsCodeHwnd() {
    hwnd := WinExist("ahk_exe Code.exe")
    if hwnd
        return hwnd
    return WinExist("ahk_exe Code - Insiders.exe")
}

FocusWorker(workerIndex) {
    global WORKERS
    hwnd := FindVsCodeHwnd()
    if !hwnd
        return false
    WinActivate("ahk_id " hwnd)
    if !WinWaitActive("ahk_id " hwnd, , 3)
        return false
    worker := WORKERS[workerIndex]
    if worker["x"] < 0 || worker["y"] < 0
        return false
    MouseClick("left", worker["x"], worker["y"], 1, 0)
    Sleep 160
    return true
}

CaptureWorkerTargets() {
    global WORKERS, STATE_PATH
    Loop WORKERS.Length {
        worker := WORKERS[A_Index]
        countdown := 3
        Loop 3 {
            ToolTip(worker["name"] . " 입력창 위에 마우스를 올리세요... " . countdown . "초")
            Sleep 1000
            countdown -= 1
        }
        MouseGetPos &mx, &my
        worker["x"] := mx
        worker["y"] := my
        WORKERS[A_Index] := worker
        IniWrite(mx, STATE_PATH, "worker_" . A_Index, "x")
        IniWrite(my, STATE_PATH, "worker_" . A_Index, "y")
    }
    ToolTip()
}

ReleaseSendModifiers() {
    SendEvent("{Ctrl up}{Shift up}{Alt up}{LWin up}{RWin up}")
    Sleep 60
}

SendPhysicalEnter() {
    ReleaseSendModifiers()
    DllCall("user32\keybd_event", "UChar", 0x0D, "UChar", 0x1C, "UInt", 0, "UPtr", 0)
    Sleep 40
    DllCall("user32\keybd_event", "UChar", 0x0D, "UChar", 0x1C, "UInt", 0x0002, "UPtr", 0)
    Sleep 60
}

SendWorkerEnter(workerIndex) {
    if !FocusWorker(workerIndex)
        return false
    SendPhysicalEnter()
    return true
}

SendWorkerPrompt(workerIndex) {
    global WORKERS
    worker := WORKERS[workerIndex]
    if !FocusWorker(workerIndex)
        return false
    prevClip := ClipboardAll()
    A_Clipboard := ""
    A_Clipboard := worker["prompt"]
    if !ClipWait(5) {
        try A_Clipboard := prevClip
        return false
    }
    Sleep 120
    SendInput("^+v")
    Sleep 320
    ReleaseSendModifiers()
    SendPhysicalEnter()
    A_Clipboard := prevClip
    return true
}

StartAutomation() {
    global g_running
    if !EnsureWorkerTargets()
        CaptureWorkerTargets()
    g_running := true
    ResetSchedules()
}

StopAutomation() {
    global g_running
    g_running := false
}

SendAllPromptsNow() {
    global WORKERS
    now := A_TickCount
    for index, worker in WORKERS {
        if SendWorkerPrompt(index) {
            worker["nextPromptTick"] := now + (worker["cycleMinutes"] * 60000)
            worker["nextEnterTick"] := now + (worker["enterSeconds"] * 1000)
            WORKERS[index] := worker
            Sleep 120
        }
    }
}

SendAllEntersNow() {
    global WORKERS
    now := A_TickCount
    for index, worker in WORKERS {
        if SendWorkerEnter(index) {
            worker["nextEnterTick"] := now + (worker["enterSeconds"] * 1000)
            WORKERS[index] := worker
            Sleep 80
        }
    }
}

SendAllPromptsAndEntersNow() {
    SendAllPromptsNow()
    Sleep 120
    SendAllEntersNow()
}

Scheduler() {
    global g_running, WORKERS
    if !g_running
        return
    now := A_TickCount
    for index, worker in WORKERS {
        if worker["nextPromptTick"] > 0 && now >= worker["nextPromptTick"] {
            if SendWorkerPrompt(index) {
                worker["nextPromptTick"] := now + (worker["cycleMinutes"] * 60000)
                worker["nextEnterTick"] := now + (worker["enterSeconds"] * 1000)
                WORKERS[index] := worker
                Sleep 120
            }
            continue
        }
        if worker["nextEnterTick"] > 0 && now >= worker["nextEnterTick"] {
            if SendWorkerEnter(index) {
                worker["nextEnterTick"] := now + (worker["enterSeconds"] * 1000)
                WORKERS[index] := worker
                Sleep 80
            }
        }
    }
}