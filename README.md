flowchart LR
    subgraph Client["Client (User / Admin)"]
        MB["Mobile Browser"]
        WB["Web Browser (PC)"]
    end

    subgraph Frontend["Frontend (HTML / JavaScript)"]
        LG["login.html"]
        SL["select.html"]
        SI["seatInfo.html"]
        AD["admin.html"]
        AL["ALERT.html"]
    end

    subgraph Backend["Backend (Node.js)"]
        SV["server.js"]
    end

    subgraph Data["Data Storage"]
        JSN["data.json"]
    end

    MB --> LG
    WB --> LG

    LG <-->|HTTP| SV
    SL <-->|HTTP| SV
    SI <-->|HTTP| SV
    AD <-->|HTTP| SV

    SV --> JSN
    JSN --> SV
