# COTHI Offline CBT Suite (Zero-Data Exam System)

High-performance offline Computer-Based Testing (CBT) suite designed for schools and exam centers with spotty or no internet data.

---

## 🚀 Key Features

1. **Zero Internet Data Required**
   - Operates entirely on any standard Wi-Fi router or Ethernet LAN switch without an active internet subscription or SIM card.
2. **Instant Submissions (5ms Drop)**
   - Submissions drop into the Administrator's console in **less than 10 milliseconds**.
   - No loading spinners, no gateway timeouts, and **zero risk of students having to rewrite**.
3. **School Customization Engine**
   - Easily rebrand the terminal for every school you deploy to:
     - School Name & Center Code
     - School Motto / Tagline
     - School Logo
     - Primary & Accent Theme Colors
4. **Dual Question Sourcing**:
   - **Option A (Create Questions)**: Web-style question builder (Options A, B, C, D, marks, explanations).
   - **Option B (COTHI School Exams)**: View and deploy standardized exam packages created centrally on `cbtbycothi.com.ng` for that school.
5. **Secure Student Kiosk**:
   - Candidate verification card with Reg No and PIN.
   - Real-time countdown timer with auto-submit protection.
   - Question palette with status indicators (Answered, Unanswered, Flagged).
   - Instant local storage auto-save on every option click.
   - Official submission confirmation receipt with candidate score.
6. **One-Click Broadsheet Export & Cloud Sync**:
   - Export all exam marks to Excel (CSV).
   - One-click sync back to `cbtbycothi.com.ng` when internet data is available.

---

## 🖥️ How to Run in the Exam Hall

### Step 1: Start the Admin Server
Double-click:
```
Start-CBT-Server.bat
```
* The server will automatically detect your local Wi-Fi IP address (e.g., `http://172.20.10.3:8000/student/`) and open the Supervisor Console.

### Step 2: Connect Student Computers / Tablets
* Connect student devices to the school's Wi-Fi router.
* On any device, open the browser and type the URL shown on your Admin screen (e.g., `http://172.20.10.3:8000/student/`).
* Or on Windows lab PCs, double-click:
  ```
  Launch-Student-Kiosk.bat
  ```
  *(This launches Microsoft Edge / Google Chrome in full-screen locked kiosk mode).*

### Step 3: Admin Actions
1. **Live Exam Monitor**: Watch candidate progress and instant submissions in real time.
2. **Create Questions**: Add custom subjects and multiple-choice questions.
3. **COTHI School Exams**: Click "Deploy to Offline Hall" to activate pre-made papers.
4. **School Branding**: Set the school's name, colors, and logo.
5. **Results & Sync**: Download Excel sheets or sync scores back to `cbtbycothi.com.ng`.

---

## 📂 Project Structure
```
c:\Users\WORK SPACE\Downloads\CBT\
├── Start-CBT-Server.bat          # 1-click batch launcher for Server & Admin
├── Launch-Student-Kiosk.bat      # 1-click batch launcher for Student Kiosk
├── main.js                       # Electron Desktop application process
├── package.json                  # NPM configuration
├── server/
│   ├── server.js                 # Zero-dependency HTTP & SSE Real-time Server
│   └── db.js                     # Local JSON database & seed records
├── public/
│   ├── admin/                    # Supervisor Console (Monitor, Builder, Branding)
│   │   ├── index.html
│   │   ├── admin.css
│   │   └── admin.js
│   └── student/                  # Student Exam Kiosk Terminal
│       ├── index.html
│       ├── kiosk.css
│       └── kiosk.js
└── data/                         # Local storage (Exams, Students, Submissions)
```
