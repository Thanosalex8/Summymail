/*
 * SummyMail Pro - Backend (Code.gs)
 */

var API_KEY =   PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
var apiKey = API_KEY; // Έτσι δουλεύει ό,τι και να γράψεις μετά
const FOLDER_ID =  "1xBKm0U79cnWQj3oTsNVz63HH65fgv-my"; 
const SCRIPT_VERSION = "27/01 17:00"; 



const scriptProperties = PropertiesService.getScriptProperties();
const ADMIN_USER = scriptProperties.getProperty('ADMIN_USER');
const ADMIN_PASS = scriptProperties.getProperty('ADMIN_PASS');


function doGet() {
  let template = HtmlService.createTemplateFromFile('index');
  template.version = SCRIPT_VERSION;
  template.sysPrompt = getGlobalPrompt(); 
  return template.evaluate()
      .setTitle('SummyMail Pro')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'); 
}

// --- NEW SETTINGS LOGIC ---


function saveGlobalPrompt(newPrompt) {
  PropertiesService.getScriptProperties().setProperty('GLOBAL_PROMPT', newPrompt);
  return "✅ Το System Prompt αποθηκεύτηκε επιτυχώς!";
}

function resetGlobalPrompt() {
  PropertiesService.getScriptProperties().deleteProperty('GLOBAL_PROMPT');
  return getBaseSystemPrompt();
}

function checkLogin(user, pass) {
  if (user === ADMIN_USER && pass === ADMIN_PASS) return { success: true };
  return { success: false, message: "Λάθος email ή κωδικός πρόσβασης...." };
}



/* New Version time stamp : 03/03/2026 22:20 
   New Version lines : 65 */
function generateQuickReport(user, pass, startDate, endDate) {
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) throw new Error("Unauthorized");
  if (!endDate) endDate = startDate;

  const projectId = 'gen-lang-client-0465952145';
  
  // Το JOIN (target_threads) φροντίζει να μην χάνονται τα παλιά συνδεδεμένα mails!
  const sql = `
    WITH expanded_data AS (
      SELECT sm.*, t_id as virtual_id 
      FROM \`gen-lang-client-0465952145.summy_logs.support_mails\` AS sm,
      UNNEST((
        SELECT ARRAY_AGG(DISTINCT id) 
        FROM UNNEST(ARRAY_CONCAT(
          IF(No_Google_Thread = TRUE, CAST([] AS ARRAY<STRING>), [thread_id]), 
          IF(other_threads IS NOT NULL AND other_threads != '', SPLIT(other_threads, ','), CAST([] AS ARRAY<STRING>))
        )) AS id WHERE id != ''
      )) as t_id
    ),
    target_threads AS (
      SELECT DISTINCT virtual_id
      FROM expanded_data
      WHERE DATE(TIMESTAMP_MILLIS(internal_date), 'Europe/Athens') BETWEEN '${startDate}' AND '${endDate}'
        AND (
          LOWER(from_info) LIKE '%support@datalink%' 
          OR LOWER(to_info) LIKE '%support@datalink%' 
          OR LOWER(cc_info) LIKE '%support@datalink%'
          OR LOWER(bcc_info) LIKE '%support@datalink%'
        )
    )
    SELECT 
      e.virtual_id as thread_id,
      MAX(e.subject) as subject,
      MAX(e.consultant_name) as consultant_name,
      MAX(e.customer_name) as customer_name,
      MAX(e.internal_date) as lastUpdate,
      ARRAY_AGG(
        STRUCT(e.message_id, e.from_name, e.internal_date, e.cleaned_body) 
        ORDER BY e.internal_date ASC
      ) as msgs
    FROM expanded_data e
    JOIN target_threads t ON e.virtual_id = t.virtual_id
    GROUP BY e.virtual_id
    ORDER BY lastUpdate DESC
  `;

  try {
    const queryResults = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    if (!queryResults.rows) return [];

    return queryResults.rows.map(row => {
      const f = row.f;
      const uniqueMsgs = [];
      const msgIds = new Set();
      (f[5].v || []).forEach(mWrap => {
        const m = mWrap.v.f;
        if (!msgIds.has(m[0].v)) {
          msgIds.add(m[0].v);
          uniqueMsgs.push({
            id: m[0].v,            
            from: m[1].v,          
            timestamp: new Date(Number(m[2].v)).toISOString(), 
            body: m[3].v || ""          
          });
        }
      });
      
      // Βεβαιωνόμαστε ότι εμφανίζονται με τη σωστή χρονολογική σειρά
      uniqueMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      return {
        id: f[0].v,
        subject: f[1].v || "(No Subject)",
        consultant: f[2].v || "Unassigned",
        client: f[3].v || "Unknown",
        lastUpdate: Number(f[4].v),
        messages: uniqueMsgs
      };
    });
  } catch (e) {
    console.error("BQ Search Failure: " + e.toString());
    return [];
  }
}


/* New Version time stamp : 03/03/2026 22:20 */
function linkEmailToThread(messageId, targetThreadId) {
  const projectId = 'gen-lang-client-0465952145';
  const cleanMsgId = String(messageId).replace(/[<>]/g, '').trim();
  const cleanTargetId = String(targetThreadId).trim();

  const sql = `
    UPDATE \`gen-lang-client-0465952145.summy_logs.support_mails\`
    SET other_threads = CASE 
        WHEN other_threads IS NULL OR other_threads = '' THEN '${cleanTargetId}'
        WHEN REGEXP_CONTAINS(other_threads, r'(^|,)${cleanTargetId}(,|$)') THEN other_threads
        ELSE CONCAT(other_threads, ',', '${cleanTargetId}')
    END
    WHERE TRIM(message_id) = '${cleanMsgId}' 
       OR message_id LIKE '%${cleanMsgId}%'
  `;

  try {
    const response = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    const rows = response.numDmlAffectedRows || "0";
    if (rows !== "0") return `✅ Επιτυχία! Το mail συνδέθηκε.`;
    return `⚠️ Αποτυχία: Το ID δεν βρέθηκε (Streaming Buffer).`;
  } catch (e) { return "❌ Σφάλμα BigQuery: " + e.toString(); }
}


/* New Version time stamp : 03/03/2026 22:20 */
function unlinkEmailFromThread(messageId, targetThreadId) {
  const projectId = 'gen-lang-client-0465952145';
  const cleanMsgId = String(messageId).replace(/[<>]/g, '').trim();
  const cleanTargetId = String(targetThreadId).trim();

  const sql = `
    UPDATE \`gen-lang-client-0465952145.summy_logs.support_mails\`
    SET 
      No_Google_Thread = CASE WHEN thread_id = '${cleanTargetId}' THEN TRUE ELSE No_Google_Thread END,
      other_threads = REGEXP_REPLACE(
                        REGEXP_REPLACE(other_threads, r'(^|,)${cleanTargetId}(,|$)', ','), 
                        r'^,|,$|,,', ''
                      )
    WHERE TRIM(message_id) = '${cleanMsgId}' 
       OR message_id LIKE '%${cleanMsgId}%'
  `;

  try {
    const response = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    const affected = response.numDmlAffectedRows || "0";
    if (affected !== "0") return `✅ Επιτυχής αφαίρεση!`;
    return `⚠️ Αποτυχία: Το ID δεν βρέθηκε (Streaming Buffer).`;
  } catch (e) { return "❌ Σφάλμα SQL: " + e.toString(); }
}



function cleanBody(text) {
  if (!text) return "";

  // 1. ΠΥΡΗΝΙΚΟ ΨΑΛΙΔΙ ΙΣΤΟΡΙΚΟΥ (Multiline Fix)
  // Κόβει οτιδήποτε ξεκινάει με "On... wrote" ή "Στις... έγραψε" ακόμα και σε πολλές γραμμές
  const historyRegex = /\n\s*(On\s[^]*?wrote:|Στις\s[^]*?έγραψε:|From:|Sent:|To:|Subject:|-----Original Message-----|________________________________)/i;
  let body = text.split(historyRegex)[0].trim();
  
  let lines = body.split('\n');
  let cleanLines = [];
  
  // Διαχωρίζουμε τους χαιρετισμούς τέλους από τους χαιρετισμούς αρχής
  const closings = ["best regards", "kind regards", "regards", "thanks", "με εκτίμηση", "φιλικά", "ευχαριστώ", "best,", "at your disposal"];
  const greetings = ["καλησπέρα", "καλημέρα", "γεια σας", "hello", "hi"];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    if (!line) { 
      if (cleanLines.length > 0) cleanLines.push(""); 
      continue; 
    }

    // Αν βρει disclaimer/νομικά, σταματάει ακαριαία
    if (line.toLowerCase().includes("disclaimer") || line.toLowerCase().includes("confidential")) break;

    // ΕΛΕΓΧΟΣ ΓΙΑ ΧΑΙΡΕΤΙΣΜΟ ΤΕΛΟΥΣ (Signature Logic)
    if (closings.some(c => line.toLowerCase().startsWith(c))) {
        cleanLines.push(line); // Προσθέτει το "Με εκτίμηση"
        
        // Ψάχνει να βρει την επόμενη γραμμή που έχει το ΟΝΟΜΑ
        for (let j = i + 1; j < lines.length; j++) {
          let nameCandidate = lines[j].trim();
          if (nameCandidate) {
            cleanLines.push(nameCandidate); // Προσθέτει "Ευθύμιος Κουνενής"
            break; // ΣΤΑΜΑΤΑΕΙ ΕΔΩ - Αγνοεί τίτλους, τηλέφωνα, εταιρείες
          }
        }
        return finalizeHtml(cleanLines); // Επιστρέφει το αποτέλεσμα αμέσως
    }
    
    cleanLines.push(line);
  }

  return finalizeHtml(cleanLines);
}

// Βοηθητική για το σωστό format του κειμένου
function finalizeHtml(linesArray) {
  return linesArray.join('<br>')
    .replace(/(<br>\s*){3,}/g, '<br><br>') 
    .trim();
}



function getFullEmailContent(msgId) {
  try {
    const msg = GmailApp.getMessageById(msgId);
    const attachments = msg.getAttachments();
    
    // Μεταφέρουμε μόνο πληροφορίες αρχείων (ακαριαίο)
    const attachmentMetadata = attachments.map((a, index) => ({
      name: a.getName(),
      size: Math.round(a.getSize() / 1024) + " KB",
      index: index
    })).filter(a => parseInt(a.size) >= 5);

    const headers = `<div style='border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:10px;'>
      <b>From:</b> ${msg.getFrom().replace(/</g, '&lt;')}<br>
      <b>Subject:</b> ${msg.getSubject()}</div>`;

    return { 
      success: true, 
      body: msg.getBody(), 
      headers: headers,
      attachments: attachmentMetadata,
      msgId: msgId
    };
  } catch (e) { return { success: false, body: e.toString() }; }
}

function getAttachmentLink(msgId, attachmentIndex) {
  const msg = GmailApp.getMessageById(msgId);
  const attachment = msg.getAttachments()[attachmentIndex];
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const file = folder.createFile(attachment);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getReportContent(fileId) {
  try {
    let html = DriveApp.getFileById(fileId).getBlob().getDataAsString();
    let parts = html.split('<div id="previewArea">');
    if (parts.length > 1) {
      return { html: parts[1].split('</div><div class="card"><h4>📂 Ιστορικό</h4>')[0] };
    }
    return { html: "" };
  } catch (e) { return { html: "" }; }
}

function saveToDrive(html, person) {
  const name = `${Utilities.formatDate(new Date(), "Europe/Athens", "dd-MM-yyyy HH:mm")} - Report.html`;
  DriveApp.getFolderById(FOLDER_ID).createFile(name, html, MimeType.HTML);
}

function getClientDomain(thread) {
  let email = thread.getMessages()[0].getFrom().toLowerCase();
  let match = email.match(/@([a-z0-9.-]+)/);
  return (match && !match[1].includes("datalink.com.gr")) ? match[1] : "Datalink / Εσωτερικό";
}

function getTimeDiff(current, prev) {
  if (!prev) return "";
  let diff = current.getTime() - prev.getTime();
  let mins = Math.floor(diff / 60000);
  if (mins < 60) return `(+${mins} λ.)`;
  return `(+${Math.floor(mins/60)} ώ. ${mins%60} λ.)`;
}

function getHistory() {
  const files = DriveApp.getFolderById(FOLDER_ID).getFilesByType(MimeType.HTML);
  let list = [];
  while (files.hasNext()) { 
    let f = files.next(); 
    list.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().getTime() }); 
  }
  return list; 
}

function LIST_MODELS() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    console.log("--- ΔΙΑΘΕΣΙΜΑ ΜΟΝΤΕΛΑ ---");
    if (data.models) {
      data.models.forEach(m => console.log(m.name));
    } else {
      console.log("Δεν βρέθηκαν μοντέλα.");
    }
  } catch (e) {
    console.log("Σφάλμα: " + e.toString());
  }
}

// --- NEW FUNCTION: SAVE TO GOOGLE SHEET ---
function saveToHistorySheet(tid, userMsg, aiResponse) {
  try {
    // 1. Βρες το ID του αρχείου Log (ή φτιάξε νέο αν δεν υπάρχει)
    const props = PropertiesService.getScriptProperties();
    let sheetId = props.getProperty("SUMMY_LOG_ID");
    
    if (!sheetId) {
      const ss = SpreadsheetApp.create("SummyMail_Chat_History");
      sheetId = ss.getId();
      props.setProperty("SUMMY_LOG_ID", sheetId);
      // Φτιάξε τις επικεφαλίδες
      ss.getSheets()[0].appendRow(["TIMESTAMP", "THREAD ID", "USER MESSAGE", "AI RESPONSE"]);
      console.log("🎉 Created New Log Sheet: " + ss.getUrl());
    }
    
    // 2. Γράψε τη νέα γραμμή
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    sheet.appendRow([new Date(), tid, userMsg, aiResponse]);
    
  } catch (e) {
    console.log("⚠️ Logging Error: " + e.toString());
  }
}

function FORCE_AUTH() {
  // Αυτή η εντολή υπάρχει μόνο για να ξυπνήσει το σύστημα αδειών
  SpreadsheetApp.create("Test_Permissions");
}


function FIX_AND_TEST_SHEET() {
  const props = PropertiesService.getScriptProperties();
  
  // 1. Σβήνουμε την παλιά μνήμη (μήπως έχει κρατήσει λάθος ID)
  props.deleteProperty("SUMMY_LOG_ID");
  console.log("1. Καθαρισμός παλιάς μνήμης: ΕΓΙΝΕ");

  // 2. Προσπαθούμε να φτιάξουμε νέο αρχείο τώρα
  try {
    const ss = SpreadsheetApp.create("SummyMail_History_NEW");
    const url = ss.getUrl();
    const id = ss.getId();
    
    // Αποθήκευση του νέου ID
    props.setProperty("SUMMY_LOG_ID", id);
    
    // Φτιάχνουμε τις στήλες
    ss.getSheets()[0].appendRow(["TIMESTAMP", "THREAD ID", "USER MESSAGE", "AI RESPONSE"]);
    ss.getSheets()[0].appendRow([new Date(), "TEST", "Δοκιμή Σύνδεσης", "Επιτυχία!"]);
    
    console.log("2. Δημιουργία Αρχείου: ΕΠΙΤΥΧΙΑ ✅");
    console.log("📂 Το αρχείο σου είναι εδώ: " + url);
    
  } catch (e) {
    console.log("❌ ΣΦΑΛΜΑ: " + e.toString());
    console.log("Πιθανή αιτία: Δεν έβαλες το 'https://www.googleapis.com/auth/spreadsheets' στο appsscript.json ή δεν έκανες Save.");


  }
}



function FINAL_SYSTEM_CHECK() {
  console.log("🔍 Ξεκινάει ο έλεγχος συστήματος...");
  
  try {
    // 1. Έλεγχος Drive & Φακέλου
    const folderName = "SummyMail_Logs";
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    
    if (folders.hasNext()) {
      folder = folders.next();
      console.log("✅ Ο φάκελος '" + folderName + "' βρέθηκε.");
    } else {
      folder = DriveApp.createFolder(folderName);
      console.log("✅ Ο φάκελος '" + folderName + "' δημιουργήθηκε τώρα.");
    }

    // 2. Έλεγχος Sheets & Αρχείου
    const testSS = SpreadsheetApp.create("TEST_CONNECTION_CHECK");
    const file = DriveApp.getFileById(testSS.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    
    console.log("✅ Το δοκιμαστικό αρχείο Excel δημιουργήθηκε μέσα στον φάκελο.");

    // 3. Έλεγχος Εγγραφής
    testSS.getSheets()[0].appendRow(["CHECK_TIME", "STATUS"]);
    testSS.getSheets()[0].appendRow([new Date(), "Όλα δουλεύουν ρολόι!"]);
    
    console.log("🚀 ΣΥΓΧΑΡΗΤΗΡΙΑ! Όλα είναι έτοιμα.");
    console.log("📂 Δες στο Drive σου τον φάκελο '" + folderName + "'.");

  } catch (e) {
    console.log("❌ ΑΠΟΤΥΧΙΑ: " + e.toString());
    if (e.toString().includes("permissions")) {
      console.log("👉 ΛΕΙΠΟΥΝ ΑΔΕΙΕΣ: Ξανατσέκαρε το appsscript.json και κάνε Save/Overwrite.");
    }
  }
}


/* New Version time stamp : 2026-02-01 13:10 
   New Version lines : 15 */

function getGlobalPrompt() {
  const saved = PropertiesService.getScriptProperties().getProperty('GLOBAL_PROMPT');
  return saved || getBaseSystemPrompt();
}




function getBaseSystemPrompt() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('el-GR');
  const timeStr = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

  return `Είσαι Senior Consultant της Datalink. Ανάλυσε τη συνομιλία Support για το SoftOne. 
Σημερινή ημερομηνία: ${todayStr} ${timeStr}.

ΟΔΗΓΙΕΣ ΑΝΑΛΥΣΗΣ:
1. ΙΣΤΟΡΙΚΟ: Συνοπτική αναφορά στο πρόβλημα.
2. ΘΕΜΑ: Προσδιόρισε το ακριβές τεχνικό ζήτημα.
3. INSIGHTS: Τι πρέπει να προσέξει ο consultant.
4. ΕΚΤΙΜΗΣΗ ΩΡΩΝ: Προτεινόμενος χρόνος υλοποίησης.

ΟΔΗΓΙΕΣ ΓΙΑ TASKS (ΚΡΙΣΙΜΟ):
- Στο τέλος της ανάλυσης, δημιούργησε μια ενότητα με τίτλο "TASKS ΠΡΟΣ ΥΛΟΠΟΙΗΣΗ".
- Κάθε task πρέπει να ξεκινάει ΜΟΝΟ με μια παύλα και κενό (π.χ. - Δημιουργία ευρετηρίου).
- Μην χρησιμοποιείς JSON, μην χρησιμοποιείς τη λέξη LOG_TASK.

Μορφοποίηση: 
- Χρησιμοποίησε καθαρή HTML (h2, h3, ul, li, p, b).
- Μην χρησιμοποιείς \`\`\`html tags.`;
}

function getAiChatResponse(threadId, chatHistory, customPrompt, chosenModel, isRecreate) {
  const startTime = Date.now();
  const projectId = 'gen-lang-client-0465952145';
  
  try {
    // 1. Φέρνουμε τα μηνύματα από BQ
    const sqlMails = `SELECT from_info, cleaned_body, customer_name, consultant_name, subject, message_id 
                      FROM \`${projectId}.summy_logs.support_mails\` 
                      WHERE thread_id = '${threadId}' OR REGEXP_CONTAINS(other_threads, r'${threadId}')`;
    const mailRes = BigQuery.Jobs.query({ query: sqlMails, useLegacySql: false }, projectId);
    
    let emailContext = "";
    let cust = "Unknown", cons = "Unknown", subj = "Unknown";

    if (mailRes.rows && mailRes.rows.length > 0) {
      cust = mailRes.rows[0].f[2].v || "Unknown";
      cons = mailRes.rows[0].f[3].v || "Unknown";
      subj = mailRes.rows[0].f[4].v || "Unknown";
      mailRes.rows.forEach((r, i) => {
        emailContext += `MSG [${i+1}]:\nFROM: ${r.f[0].v}\nBODY: ${r.f[1].v}\n---\n`;
      });
      console.log("✅ Found " + mailRes.rows.length + " messages. Proceeding to AI...");
    }

    // 2. Κλήση Gemini
    const systemText = `Πελάτης: ${cust}\nΣύμβουλος: ${cons}\n\n${customPrompt}\n\nDATA:\n${emailContext}`;
    const modelName = chosenModel || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
    
    const response = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({ system_instruction: { parts: [{ text: systemText }] }, contents: chatHistory }),
      muteHttpExceptions: true
    });
    
    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0]) {
      const aiText = json.candidates[0].content.parts[0].text.replace(/```json|```html|```/g, '').trim();
      const usage = json.usageMetadata || {};

      // 3. ΕΓΓΡΑΦΗ ΣΤΗ ΒΑΣΗ (Εδώ είναι το κρίσιμο σημείο)
      writeToBigQuery({
        tid: threadId,
        subject: subj,
        msgCount: mailRes.rows ? mailRes.rows.length : 0,
        model: modelName,
        userPrompt: chatHistory.length > 0 ? chatHistory[chatHistory.length-1].parts[0].text : "Initial",
        aiResponse: aiText,
        totalContext: systemText,
        pTokens: usage.promptTokenCount || 0,
        oTokens: usage.candidatesTokenCount || 0,
        tTokens: usage.totalTokenCount || 0,
        latency: Date.now() - startTime,
        reason: json.candidates[0].finishReason || "STOP",
        isRecreate: isRecreate
      });

      return aiText;
    }
    return "⚠️ AI Error: " + response.getContentText();

  } catch (e) {
    console.error("❌ CRITICAL ERROR: " + e.message);
    return "⚠️ Σφάλμα Server: " + e.message;
  }
}

function writeToBigQuery(data) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'chat_history';

  // Καθαρισμός για SQL
  const safe = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

  try {
    if (data.isRecreate) {
      const delSql = `DELETE FROM \`${projectId}.${datasetId}.${tableId}\` WHERE threadId = '${data.tid}'`;
      BigQuery.Jobs.query({ query: delSql, useLegacySql: false }, projectId);
    }

    const sql = `INSERT INTO \`${projectId}.${datasetId}.${tableId}\` 
      (timestamp, threadId, subject, message_count, user_email, user_locale, model_name, user_prompt, aiResponse, total_context, prompt_tokens, output_tokens, total_tokens, latency_ms, finish_reason)
      VALUES (
        CURRENT_TIMESTAMP(), '${data.tid}', '${safe(data.subject)}', ${Number(data.msgCount)}, 
        '${Session.getActiveUser().getEmail()}', '${Session.getActiveUserLocale()}', '${data.model}', 
        '${safe(data.userPrompt)}', '${safe(data.aiResponse)}', '${safe(data.totalContext)}', 
        ${data.pTokens}, ${data.oTokens}, ${data.tTokens}, ${data.latency}, '${data.reason}'
      )`;

    BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    console.log("🚀 SQL SUCCESS: Data written to BQ for " + data.tid);
  } catch (e) {
    console.error("❌ BQ WRITE FAIL: " + e.message);
  }
}





function aiAutomatedLoggerBatch(taskPackage, threadId, customer, consultant, isRecreate) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  
  try {
    if (!taskPackage || taskPackage.length === 0) return "⚠️ Άδειο πακέτο.";

    // --- ΑΝ ΠΑΤΗΘΗΚΕ ΤΟ "ΕΠΑΝΑΔΗΜΙΟΥΡΓΙΑ", ΣΒΗΝΟΥΜΕ ΤΑ ΠΑΛΙΑ ΠΡΙΝ ΓΡΑΨΟΥΜΕ ---
    if (isRecreate === true) {
      var deleteLinesSql = "DELETE FROM `" + projectId + "." + datasetId + ".task_lines` WHERE thread_id = '" + threadId + "'";
      BigQuery.Jobs.query({ query: deleteLinesSql, useLegacySql: false }, projectId);
    }

    var maxIdQuery = "SELECT MAX(task_id) as max_id FROM `" + projectId + "." + datasetId + ".tasks`";
    var maxIdResult = BigQuery.Jobs.query({ query: maxIdQuery, useLegacySql: false }, projectId);
    
    var currentMaxId = 0;
    if (maxIdResult.rows && maxIdResult.rows.length > 0 && maxIdResult.rows[0].f[0].v) {
      currentMaxId = parseInt(maxIdResult.rows[0].f[0].v, 10);
    }

    var taskMap = {}; 
    var newTasksArray = []; 
    var linesArray = [];    

    var cleanCustomer = String(customer || "Unknown").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");
    var cleanConsultant = String(consultant || "Unknown").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");

    taskPackage.forEach(function(item) {
      var tId = item.entry.task_id;
      var tName = String(item.entry.task_name || "Νέα Εργασία από AI").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");
      var sId = item.entry.status_id;
      sId = Number(Array.isArray(sId) ? sId[0] : sId);

      if (tId === "NEW" || !tId || isNaN(parseInt(tId))) {
        if (!taskMap[tName]) {
          currentMaxId++; 
          taskMap[tName] = currentMaxId;
          newTasksArray.push("(" + currentMaxId + ", '" + tName + "')");
        }
        tId = taskMap[tName];
      } else {
        tId = Number(Array.isArray(tId) ? tId[0] : tId);
      }

      linesArray.push("('" + item.msgId + "', '" + threadId + "', " + tId + ", " + sId + ", '" + cleanCustomer + "', '" + cleanConsultant + "', CURRENT_TIMESTAMP())");
    });

    if (newTasksArray.length > 0) {
      var insertTasksSql = "INSERT INTO `" + projectId + "." + datasetId + ".tasks` (task_id, task_name) VALUES " + newTasksArray.join(", ");
      BigQuery.Jobs.query({ query: insertTasksSql, useLegacySql: false }, projectId);
    }

    if (linesArray.length > 0) {
      var insertLinesSql = "INSERT INTO `" + projectId + "." + datasetId + ".task_lines` (message_id, thread_id, task_id, status_id, customer_name, consultant_name, updated_at) VALUES " + linesArray.join(", ");
      BigQuery.Jobs.query({ query: insertLinesSql, useLegacySql: false }, projectId);
    }

    let prefix = isRecreate ? "🔄 Διαγράφηκαν τα παλιά και δημιουργήθηκαν " : "✅ Δημιουργήθηκαν ";
    return prefix + newTasksArray.length + " νέα tasks & " + linesArray.length + " γραμμές!";
  } catch (e) {
    return "❌ Σφάλμα BigQuery: " + e.message;
  }
}




function getImportProgress() {
  return CacheService.getUserCache().get("import_count") || "0";
}


function deleteDateActionProxy(dateIso) {
  return deleteDateFromBQ(dateIso);
}

/**
 * Διαγράφει όλα τα μηνύματα μιας συγκεκριμένης ημερομηνίας από τη BigQuery.
 */
function deleteDateFromBQ(dateIso) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'support_mails';

  // Αν δεν δοθεί ημερομηνία, παίρνει τη σημερινή
  const targetDate = dateIso || Utilities.formatDate(new Date(), "GMT+2", "yyyy-MM-dd");

  // Query για διαγραφή βάσει της ημερομηνίας internal_date (μετατροπή από millis σε DATE)
  const query = `DELETE FROM \`${projectId}.${datasetId}.${tableId}\` 
                 WHERE DATE(TIMESTAMP_MILLIS(internal_date), 'Europe/Athens') = '${targetDate}'`;

  const request = {
    query: query,
    useLegacySql: false
  };

  try {
    // Εκτέλεση του Delete Job στη BigQuery
    BigQuery.Jobs.query(request, projectId);
    return "✅ Επιτυχής διαγραφή δεδομένων για: " + targetDate;
  } catch (e) {
    console.error("Σφάλμα διαγραφής: " + e);
    return "❌ Σφάλμα κατά τη διαγραφή: " + e.message;
  }
}

/* New Version 18-02-2026 00:20 - COMPLETE PACKAGE WITH TIMEZONE FIX */

/**
 * Βοηθητική: Ελέγχει πόσες εγγραφές υπάρχουν για τη συγκεκριμένη ημερομηνία
 */
function getRowCountForDate(dateIso) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'support_mails';
  const query = `SELECT COUNT(*) as cnt FROM \`${projectId}.${datasetId}.${tableId}\` 
                 WHERE DATE(TIMESTAMP_MILLIS(internal_date), 'Europe/Athens') = '${dateIso}'`;
  
  const request = { query: query, useLegacySql: false };
  try {
    const results = BigQuery.Jobs.query(request, projectId);
    return parseInt(results.rows[0].f[0].v);
  } catch(e) { return 0; }
}


function getAttachmentsInfo(msg) {
  const attachments = msg.getAttachments();
  if (!attachments || attachments.length === 0) return "";
  return attachments.map(att => {
    const size = att.getSize();
    const sizeStr = size < 1048576 ? Math.round(size / 1024) + "kb" : (size / 1048576).toFixed(1) + "mb";
    return `${att.getName()} | >${sizeStr}`;
  }).join(", ");
}


/* New Version time stamp : 2026-02-26 17:55 */
function bulkSaveActionProxy(start, end) {
  return bulkSaveToBQ(start, end);
}


/**
 * Βοηθητική: Αναγνώριση Consultant βάσει ονομάτων και keywords
 */
function extractConsultant(thread) {
  const msgs = thread.getMessages();
  const participants = msgs.map(m => m.getFrom().toLowerCase()).join(" ");
  const fullBodyText = msgs.map(m => m.getPlainBody().toLowerCase()).join(" ");
  
  let consultant = "⚠️ Unassigned"; 
  
  if (participants.includes("tolis") || fullBodyText.includes("τόλης") || fullBodyText.includes("tolis")) {
    consultant = "Tolis";
  } else if (participants.includes("thimios") || participants.includes("tkounenis") || fullBodyText.includes("θύμιος") || fullBodyText.includes("thimios") || fullBodyText.includes("kounenis")) {
    consultant = "Thymios";
  } else if (participants.includes("nikos") || participants.includes("nikonst") || fullBodyText.includes("νίκος") || fullBodyText.includes("nikos")) {
    consultant = "Nikos";
  } else if (participants.includes("alex@datalink") || participants.includes("alex.") || participants.includes("me@") || fullBodyText.includes("αλεξανδρής") || fullBodyText.includes("alexandris") || fullBodyText.includes("θάνος") || fullBodyText.includes("thanos")) {
    consultant = "Thanos";
  }
  
  return consultant;
}



/* New Version time stamp : 2026-02-25 17:30 */
/* New Version lines : 115 */
/* Prev Version time stamp : 2026-02-25 16:45 */

/**
 * 1. Φέρνει όλα τα υπάρχοντα Message IDs από τη BQ για αποφυγή διπλοτύπων
 */
function getAllExistingMessageIds() {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'support_mails';
  const sql = `SELECT message_id FROM \`${projectId}.${datasetId}.${tableId}\``;
  
  const existingSet = new Set();
  try {
    const queryResults = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    if (queryResults.rows) {
      queryResults.rows.forEach(row => existingSet.add(row.f[0].v));
    }
  } catch (e) {
    console.warn("Table might be empty or missing: " + e.message);
  }

  console.log("Σύνολο IDs στη BigQuery: " + existingSet.size); // ΠΡΟΣΘΕΣΕ ΑΥΤΟ
  return existingSet;
}


/* New Version time stamp : 2026-02-26 18:25 */
/* New Version lines : 125 */
/* Prev Version time stamp : 2026-02-26 18:15 */
/* Prev Version λινεσ : 108 */

function bulkSaveToBQ(startDate, endDate) {
  const startTime = new Date().getTime(); 
  if (!startDate) startDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'support_mails'; 
  const cache = CacheService.getUserCache();
  
  const existingIds = getAllExistingMessageIds();

  // Λογική ημερομηνιών
  let dEndObj;
  if (!endDate || endDate === "") {
    dEndObj = new Date();
    dEndObj.setDate(dEndObj.getDate() + 1);
  } else {
    const parts = endDate.split("-");
    dEndObj = new Date(parts[0], parts[1] - 1, parts[2]);
    dEndObj.setDate(dEndObj.getDate() + 1);
  }

  const query = `after:${startDate.replace(/-/g, '/')} before:${Utilities.formatDate(dEndObj, Session.getScriptTimeZone(), "yyyy/MM/dd")}`;

  let totalSaved = 0;
  let startIndex = 0;
  const pageSize = 100; 
  let continueSearching = true;

  while (continueSearching) {
    // Check for Apps Script 6-minute limit (360s). We stop at 300s (5 min) to be safe.
    if (new Date().getTime() - startTime > 300000) {
      console.warn("⚠️ Safety Timeout! Saved " + totalSaved + " so far. Run again to continue.");
      break; 
    }

    const threads = GmailApp.search(query, startIndex, pageSize);
    if (threads.length === 0) break;

    let currentBatchRows = []; 

    threads.forEach((thread) => {
      const msgs = thread.getMessages();
      let consultant = extractConsultant(thread); 
      let clientDomain = getClientDomain(thread);

      msgs.forEach(msg => {
        const mId = msg.getId();
        const participants = (msg.getFrom() + msg.getTo() + msg.getCc() + msg.getBcc()).toLowerCase();
        
        if (participants.includes("support@datalink") && !existingIds.has(mId)) {
          const rawContent = msg.getRawContent() || "";
          const plainBody = msg.getPlainBody() || "";
          const headers = parseRawHeaders(rawContent); 

          const rowData = {
            message_id: mId,
            thread_id: thread.getId(),
            internal_date: msg.getDate().getTime(),
            subject: msg.getSubject(),
            from_info: msg.getFrom(),
            from_name: msg.getFrom().split('<')[0].replace(/"/g, "").trim(),
            from_email: msg.getFrom().includes('<') ? msg.getFrom().split('<')[1].replace('>', '') : msg.getFrom(),
            to_info: msg.getTo(),
            cc_info: msg.getCc() || "",
            bcc_info: msg.getBcc() || "",
            header_date: msg.getDate().toString(),
            raw_body: plainBody,
            cleaned_body: cleanBody(plainBody),
            snippet: (plainBody.substring(0, 180).replace(/\s+/g, ' ').trim() + "..."),
            mime_type: headers.contentType || "text/plain",
            raw_message: rawContent.substring(0, 48000), 
            attachments_info: getAttachmentsInfo(msg),
            attachment_count: msg.getAttachments().length,
            attachment_names: msg.getAttachments().map(a => a.getName()).join(", "),
            has_attachment: msg.getAttachments().length > 0,
            consultant_name: consultant,
            customer_name: clientDomain,
            sender_domain: clientDomain,
            client_id: null, 
            consultant_id: null, 
            msg_id_rfc: headers.messageId,
            in_reply_to: headers.inReplyTo,
            references_id: headers.references,
            originating_ip: headers.ip,
            user_agent: headers.userAgent,
            mailer_info: headers.mailer,
            auto_submitted: headers.autoSubmitted,
            list_id: headers.listId,
            list_unsubscribe: headers.listUnsubscribe,
            return_path: headers.returnPath,
            delivered_to: headers.deliveredTo,
            priority: headers.priority,
            reply_to: msg.getReplyTo(),
            auth_results: headers.authResults,
            received_spf: headers.spf,
            content_lang: headers.lang,
            recorded_at: new Date().toISOString(),
            size_estimate: Number(rawContent.length)
          };

          currentBatchRows.push({ json: rowData });
          existingIds.add(mId);
        }
      });
    });

    // INCREMENTAL SAVE: Σώζουμε το batch αμέσως
    if (currentBatchRows.length > 0) {
      try {
        BigQuery.Tabledata.insertAll({
          kind: "bigquery#tableDataInsertAllRequest",
          rows: currentBatchRows
        }, projectId, datasetId, tableId);
        totalSaved += currentBatchRows.length;
        cache.put("import_count", totalSaved.toString(), 60);
      } catch (e) {
        console.error("Batch BQ Error: " + e.toString());
      }
    }

    if (threads.length < pageSize) break;
    startIndex += pageSize;
  }

  return totalSaved;
}

/* Prev Version time stamp: 2026-02-27 00:10 */
/* Prev Version lines: 105 */


function parseRawHeaders(raw) {
  const getHeader = (regex) => {
    const match = raw.match(regex);
    return match ? match[1].trim() : "";
  };

  return {
    messageId: getHeader(/^Message-ID:\s*(.*)$/mi),
    inReplyTo: getHeader(/^In-Reply-To:\s*(.*)$/mi),
    references: getHeader(/^References:\s*([\s\S]*?)(?:\r?\n[^\s\t]|$)/mi).replace(/\s+/g, ' '),
    ip: getHeader(/^Received:\s*from\s*.*?\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/mi),
    userAgent: getHeader(/^User-Agent:\s*(.*)$/mi),
    mailer: getHeader(/^X-Mailer:\s*(.*)$/mi),
    autoSubmitted: getHeader(/^Auto-Submitted:\s*(.*)$/mi),
    listId: getHeader(/^List-ID:\s*(.*)$/mi),
    listUnsubscribe: getHeader(/^List-Unsubscribe:\s*(.*)$/mi),
    returnPath: getHeader(/^Return-Path:\s*(.*)$/mi),
    deliveredTo: getHeader(/^Delivered-To:\s*(.*)$/mi),
    priority: getHeader(/^X-Priority:\s*(.*)$/mi) || getHeader(/^Importance:\s*(.*)$/mi),
    authResults: getHeader(/^Authentication-Results:\s*(.*)$/mi),
    spf: getHeader(/^Received-SPF:\s*(.*)$/mi),
    lang: getHeader(/^Content-Language:\s*(.*)$/mi),
    contentType: getHeader(/^Content-Type:\s*([^;]*)/mi) // Εξαγωγή MIME type
  };
}




function scheduledDailySync() {
  const projectId = 'gen-lang-client-0465952145';
  
  // Υπολογισμός χθεσινής ημερομηνίας
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = Utilities.formatDate(yesterday, "Europe/Athens", "yyyy-MM-dd");

  const sql = `
    SELECT 
      customer_name, 
      COUNT(DISTINCT thread_id) as thread_count,
      COUNT(*) as msg_count
    FROM \`gen-lang-client-0465952145.summy_logs.support_mails\`
    WHERE DATE(TIMESTAMP_MILLIS(internal_date), 'Europe/Athens') = '${dateStr}'
    GROUP BY customer_name
    ORDER BY thread_count DESC
  `;

  try {
    const queryResults = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    let reportBody = "Καλημέρα,\n\nΑκολουθεί η σύνοψη της υποστήριξης για τις " + dateStr + ":\n\n";
    
    if (queryResults.rows && queryResults.rows.length > 0) {
      queryResults.rows.forEach(row => {
        const f = row.f;
        reportBody += "🏢 Πελάτης: " + (f[0].v || "Unknown") + "\n";
        reportBody += "📂 Ανοιχτά Θέματα: " + f[1].v + "\n";
        reportBody += "📩 Σύνολο Mails: " + f[2].v + "\n";
        reportBody += "-------------------------------\n";
      });
    } else {
      reportBody += "Δεν καταγράφηκε κινητικότητα για τη χθεσινή ημέρα.";
    }

    // Αποστολή στο ADMIN_USER (support@datalink.com.gr)
    MailApp.sendEmail(ADMIN_USER, "SummyMail Daily Briefing [" + dateStr + "]", reportBody);
    console.log("Daily briefing sent successfully.");
    
  } catch (e) {
    console.error("Daily Sync Agent Failure: " + e.toString());
  }
}



function fetchChatHistoryFromBQ(threadId) {
  const projectId = 'gen-lang-client-0465952145';
  
  // Καθαρισμός του threadId για να μην υπάρχουν κρυφοί χαρακτήρες
  const cleanId = String(threadId).trim();

  // Χρησιμοποιούμε TRIM() και στην SQL για να είμαστε σίγουροι ότι η βάση θα απαντήσει
  const sql = `
    SELECT user_prompt, aiResponse
    FROM \`gen-lang-client-0465952145.summy_logs.chat_history\`
    WHERE TRIM(threadId) = '${cleanId}'
    ORDER BY timestamp ASC
  `;

  try {
    const queryResults = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    
    // Αν η BQ δεν βρει τίποτα, επιστρέφουμε άδειο πίνακα αμέσως
    if (!queryResults.rows || queryResults.rows.length === 0) {
      console.log("ℹ️ BQ Info: No history found for thread: " + cleanId);
      return [];
    }
    
    let history = [];
    queryResults.rows.forEach(row => {
      const uPrompt = row.f[0].v;
      const aiResp = row.f[1].v;
      
      // Ανακατασκευή ιστορικού για το Gemini API
      if (uPrompt && uPrompt !== "null") {
        history.push({ role: "user", parts: [{ text: String(uPrompt) }] });
      }
      if (aiResp && aiResp !== "null") {
        history.push({ role: "model", parts: [{ text: String(aiResp) }] });
      }
    });
    
    console.log("✅ BQ Success: Loaded " + history.length + " messages for refresh.");
    return history;
  } catch (e) {
    console.error("❌ BQ Chat Fetch Error: " + e.toString());
    return [];
  }
}




function scheduledBatchSync() {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'support_mails'; 
  
  const existingIds = getAllExistingMessageIds();
  
  const query = "newer_than:1d";
  const threads = GmailApp.search(query, 0, 100);
  
  if (threads.length === 0) return "Κανένα νέο Thread.";

  let ndjsonRows = []; 
  let savedCount = 0;
  let importedSubjects = []; // 📌 Εδώ θα μαζεύουμε τα θέματα!

  threads.forEach((thread) => {
    const msgs = thread.getMessages();
    let consultant = extractConsultant(thread); 
    let clientDomain = getClientDomain(thread);

    msgs.forEach(msg => {
      const mId = msg.getId();
      const participants = (msg.getFrom() + msg.getTo() + msg.getCc() + msg.getBcc()).toLowerCase();
      
      if (participants.includes("support@datalink") && !existingIds.has(mId)) {
        const rawContent = msg.getRawContent() || "";
        const plainBody = msg.getPlainBody() || "";
        const headers = parseRawHeaders(rawContent); 
        const subject = msg.getSubject() || "(Χωρίς Θέμα)";

        const rowData = {
          message_id: mId,
          thread_id: thread.getId(),
          internal_date: msg.getDate().getTime(),
          subject: subject,
          from_info: msg.getFrom(),
          from_name: msg.getFrom().split('<')[0].replace(/"/g, "").trim(),
          from_email: msg.getFrom().includes('<') ? msg.getFrom().split('<')[1].replace('>', '') : msg.getFrom(),
          to_info: msg.getTo(),
          cc_info: msg.getCc() || "",
          bcc_info: msg.getBcc() || "",
          header_date: msg.getDate().toString(),
          raw_body: plainBody,
          cleaned_body: cleanBody(plainBody),
          snippet: (plainBody.substring(0, 180).replace(/\s+/g, ' ').trim() + "..."),
          mime_type: headers.contentType || "text/plain",
          raw_message: rawContent.substring(0, 48000), 
          attachments_info: getAttachmentsInfo(msg),
          attachment_count: msg.getAttachments().length,
          attachment_names: msg.getAttachments().map(a => a.getName()).join(", "),
          has_attachment: msg.getAttachments().length > 0,
          consultant_name: consultant,
          customer_name: clientDomain,
          sender_domain: clientDomain,
          client_id: null, 
          consultant_id: null, 
          msg_id_rfc: headers.messageId,
          in_reply_to: headers.inReplyTo,
          references_id: headers.references,
          originating_ip: headers.ip,
          user_agent: headers.userAgent,
          mailer_info: headers.mailer,
          auto_submitted: headers.autoSubmitted,
          list_id: headers.listId,
          list_unsubscribe: headers.listUnsubscribe,
          return_path: headers.returnPath,
          delivered_to: headers.deliveredTo,
          priority: headers.priority,
          reply_to: msg.getReplyTo(),
          auth_results: headers.authResults,
          received_spf: headers.spf,
          content_lang: headers.lang,
          recorded_at: new Date().toISOString(),
          size_estimate: Number(rawContent.length)
        };

        ndjsonRows.push(JSON.stringify(rowData));
        existingIds.add(mId);
        
        // 📌 Αποθήκευση του θέματος για το Log
        importedSubjects.push(subject); 
        savedCount++;
      }
    });
  });

  if (ndjsonRows.length === 0) {
    // Σιωπηλό log για να μην γεμίζει με σκουπίδια
    return "Κανένα νέο mail.";
  }

  const ndjsonString = ndjsonRows.join('\n');
  const blob = Utilities.newBlob(ndjsonString, "application/octet-stream");

  const job = {
    configuration: {
      load: {
        destinationTable: { projectId: projectId, datasetId: datasetId, tableId: tableId },
        sourceFormat: "NEWLINE_DELIMITED_JSON",
        writeDisposition: "WRITE_APPEND"
      }
    }
  };

  try {
    BigQuery.Jobs.insert(job, projectId, blob);
    
    // 📌 Εκτύπωση στο Log του Apps Script
    let logMessage = `✅ Επιτυχής φόρτωση ${savedCount} νέων mails!\nΛίστα Θεμάτων:\n- ` + importedSubjects.join('\n- ');
    console.log(logMessage);
    
    return `Επιτυχία: ${savedCount}`;
  } catch (e) {
    console.error("Σφάλμα Load Job BQ: " + e.toString());
    return "Σφάλμα: " + e.toString();
  }
}
/* New Version time stamp : 06-03-2026 15:45 
   Smart Router for Triggers */
function smartScheduleRouter() {
  // Παίρνουμε την ακριβή ώρα Ελλάδος (u = ημέρα 1-7 όπου 1 η Δευτέρα, H = Ώρα 0-23, m = λεπτά 0-59)
  const nowStr = Utilities.formatDate(new Date(), "Europe/Athens", "u-H-m");
  const parts = nowStr.split('-');
  const day = parseInt(parts[0]);
  const hour = parseInt(parts[1]);
  const minute = parseInt(parts[2]);
  
  const isWeekday = (day >= 1 && day <= 5); // 1 (Δευ) έως 5 (Παρ)
  const isBeforeSix = (hour < 18);          // 00:00 έως 17:59

  if (isWeekday && isBeforeSix) {
    // 1. Καθημερινές έως τις 18:00 -> Τρέχει κάθε λεπτό!
    scheduledBatchSync();
  } 
  else if (minute % 10 === 0) {
    // 2. Μετά τις 18:00 ή Σαββατοκύριακα -> Τρέχει ΜΟΝΟ αν το λεπτό λήγει σε 0 (ανά 10λεπτο)
    scheduledBatchSync();
  } 
  else {
    // 3. Ενδιάμεσα λεπτά εκτός ωραρίου -> Αθόρυβος τερματισμός.
    return;
  }
}


/**
 * 1. Φέρνει τα σχετικά Tasks (Thread & Customer) για να τα "δεί" το AI
 */
function getTasksForAIContext(threadId, customerName) {
  const projectId = 'gen-lang-client-0465952145';
  const sql = `
    SELECT DISTINCT t.task_id, t.task_name, 'THREAD' as source
    FROM \`gen-lang-client-0465952145.summy_logs.task_lines\` tl
    JOIN \`gen-lang-client-0465952145.summy_logs.tasks\` t ON tl.task_id = t.task_id
    WHERE tl.thread_id = '${threadId}'
    UNION DISTINCT
    SELECT DISTINCT t.task_id, t.task_name, 'CUSTOMER' as source
    FROM \`gen-lang-client-0465952145.summy_logs.task_lines\` tl
    JOIN \`gen-lang-client-0465952145.summy_logs.tasks\` t ON tl.task_id = t.task_id
    WHERE tl.customer_name = '${customerName}'
  `;
  try {
    const results = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    if (!results.rows) return "Κανένα υπάρχον Task.";
    return results.rows.map(r => `[ID: ${r.f[0].v}] ${r.f[1].v}`).join('\n');
  } catch (e) { return "Σφάλμα Context."; }
}

function aiAutomatedLogger(entry, messageIds, threadId, customer, consultant) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds];

  try {
    let taskId = entry.task_id;

    // --- SQL SANITIZATION: Αλεξίσφαιρος καθαρισμός κειμένων ---
    const cleanName = String(entry.task_name || "New Task")
      .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");
      
    const cName = String(customer || "Unknown")
      .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");
      
    const consName = String(consultant || "Unknown")
      .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");
    // -----------------------------------------------------------

    if (taskId === "NEW") {
      const maxIdSql = `SELECT MAX(task_id) as max_id FROM \`${projectId}.${datasetId}.tasks\``;
      const res = BigQuery.Jobs.query({ query: maxIdSql, useLegacySql: false }, projectId);
      let nextId = 100;
      if (res.rows && res.rows[0].f[0].v !== null) nextId = Number(res.rows[0].f[0].v) + 1;

      const sqlInsertTask = `INSERT INTO \`${projectId}.${datasetId}.tasks\` (task_id, task_name) VALUES (${nextId}, '${cleanName}')`;
      
      BigQuery.Jobs.query({ query: sqlInsertTask, useLegacySql: false }, projectId);
      taskId = nextId;
    } else {
      taskId = Number(Array.isArray(taskId) ? taskId[0] : taskId);
    }

    const sId = Number(Array.isArray(entry.status_id) ? entry.status_id[0] : entry.status_id);

    const valuesList = ids.map(id => {
      return `('${id}', '${threadId}', ${taskId}, ${sId}, '${cName}', '${consName}', CURRENT_TIMESTAMP())`;
    }).join(",");

    const sqlLines = `INSERT INTO \`${projectId}.${datasetId}.task_lines\` 
      (message_id, thread_id, task_id, status_id, customer_name, consultant_name, updated_at) 
      VALUES ${valuesList}`;
    
    const queryResults = BigQuery.Jobs.query({ query: sqlLines, useLegacySql: false }, projectId);

    if (queryResults.errors) return "❌ BQ Error: " + queryResults.errors[0].message;
    return "✅ Success: Task " + taskId;

  } catch (e) {
    return "❌ Crash: " + e.toString();
  }
}

function getMailTaskQueue(messageId, threadId) {
  const projectId = 'gen-lang-client-0465952145';
  const sql = `
    SELECT t.task_name, ts.status_name, tl.status_id, tl.updated_at
    FROM \`gen-lang-client-0465952145.summy_logs.task_lines\` tl
    JOIN \`gen-lang-client-0465952145.summy_logs.tasks\` t ON tl.task_id = t.task_id
    JOIN \`gen-lang-client-0465952145.summy_logs.task_status\` ts ON tl.status_id = ts.status_id
    WHERE tl.message_id = '${messageId}'
    ORDER BY tl.updated_at DESC
  `;
  try {
    const res = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    return res.rows ? res.rows.map(r => ({
      task: r.f[0].v, status: r.f[1].v, sId: r.f[2].v,
      date: Utilities.formatDate(new Date(r.f[3].v), "Europe/Athens", "HH:mm")
    })) : [];
  } catch(e) { return []; }
}

function getTaskAssignmentPrompt() {
  return `Είσαι Project Manager της Datalink. Η αποστολή σου είναι ΑΠΟΚΛΕΙΣΤΙΚΑ η παραγωγή JSON εντολών για τη BigQuery.

🎯 ΑΝΑΛΥΣΗ STATUS (Επιλογή με βάση το περιεχόμενο):
[1] ΑΝΑΜΟΝΗ ΑΝΑΘΕΣΗΣ: Νέο αίτημα που μόλις ήρθε και δεν έχει αναληφθεί ακόμα από σύμβουλο.
[2] ΕΝΑΡΞΗ/ΑΝΑΘΕΣΗ: Όταν ένας σύμβουλος λέει "θα το δω", "το ανέλαβα" ή ξεκινά μια νέα εργασία.
[3] ΕΞΕΛΙΞΗ (ΕΚΚΡ.ΠΕΛΑΤΗ): Η Datalink ρωτάει κάτι τον πελάτη ή περιμένει αρχεία/πρόσβαση από αυτόν η μπάλα είναι στον πελάτη.
[4] ΕΞΕΛΙΞΗ (ΕΚΚΡ.DATALINK): Ο πελάτης απάντησε ή ζήτησε κάτι νέο και η μπάλα είναι στην πλευρά μας.
[5] ΟΛΟΚΛΗΡΩΣΗ: Η "ΤΕΧΝΙΚΗ ΠΑΡΑΔΟΣΗ". Χρησιμοποίησε το ΜΟΝΟ όταν ο σύμβουλος παραδίδει τη λύση (π.χ. "το έφτιαξα", "έγινε η αλλαγή", "έτοιμο το report"). Είναι η στιγμή που η εργασία τελειώνει πρακτικά.
[6] ΑΠΟΚΡΙΣΗ: "ΕΠΙΒΕΒΑΙΩΣΗ / ACKNOWLEDGMENT". Χρησιμοποίησε το για απλά ευχαριστώ, "το είδα", "συμφωνώ" ή γενικά σχόλια που δεν παράγουν τεχνικό έργο. (Ποτέ 5 αν ο πελάτης λέει απλά "ευχαριστώ").
[7] ΥΠΟΣΤΗΡΙΞΗ (0,25 ή 0,5 ώρες): Σύντομες, χρεώσιμες εργασίες υποστήριξης που αναφέρονται ρητά ως τέτοιες.
[8] ΥΠΟΣΤΗΡΙΞΗ (Χωρίς Χρέωση): Σύντομες εργασίες που ο σύμβουλος προσφέρει δωρεάν.
[9] ΑΡΣΗ ΕΚΚΡΕΜΟΤΗΤΑΣ: Όταν ένα πρόβλημα που μπλόκαρε το task λύθηκε ρητά.
[10] ΜΕΛΛΟΝΤΙΚΟ: Προγραμματισμός εργασίας για το μέλλον ή αναβολή.
[11] ΕΝΗΜΕΡΩΣΗ: Γενική πληροφόρηση (FYI) χωρίς να απαιτείται ενέργεια.
[12] ΕΞΕΛΙΞΗ (TICKET SOFT1): Όταν περιμένουμε απάντηση από το support της SoftOne.
[13] ΑΚΥΡΩΣΗ: Αν το αίτημα ακυρωθεί από οποιαδήποτε πλευρά.

🛑 ΑΠΑΡΑΒΑΤΟΙ ΤΕΧΝΙΚΟΙ ΚΑΝΟΝΕΣ:
1. FORCED BIRTH RULE: Κάθε task (NEW ή ID) πρέπει να "γεννιέται" με status 1 ή 2. 
   - ΑΠΑΓΟΡΕΥΕΤΑΙ (PROHIBITED) να ξεκινήσεις task με 3, 4, 6, 7, 10, 11.
   - ΕΞΑΙΡΕΣΗ: Αν το task ξεκινά και τελειώνει στο ΙΔΙΟ μήνυμα, βάλε ΜΟΝΟ status 5.
2. EXACT NAME CONSISTENCY: Το 'task_name' πρέπει να είναι ΑΝΤΙΓΡΑΦΗ-ΕΠΙΚΟΛΛΗΣΗ (byte-for-byte) σε όλες τις εγγραφές του ίδιου task μέσα στο thread.
3. ZERO HALLUCINATION ID RULE (CRITICAL - SYSTEM OVERRIDE): 
   - ΤΟ ΣΥΣΤΗΜΑ ΜΑΣ ΔΗΜΙΟΥΡΓΕΙ ΤΑ IDs, ΟΧΙ ΕΣΥ. Η λέξη "NEW" είναι απλά μια ταμπέλα (flag) για το Backend μας.
   - Κοίταξε τη λίστα "ΕΝΕΡΓΑ TASKS ΣΤΗ ΒΑΣΗ". Αν το θέμα υπάρχει, βάλε το νούμερο του.
   - ΑΝ Η ΛΙΣΤΑ ΕΙΝΑΙ ΑΔΕΙΑ Ή ΤΟ ΘΕΜΑ ΕΙΝΑΙ ΚΑΙΝΟΥΡΓΙΟ, η ΜΟΝΑΔΙΚΗ επιτρεπτή τιμή είναι το string "NEW".
   - ΑΠΑΓΟΡΕΥΕΤΑΙ Η ΑΡΙΘΜΗΣΗ (π.χ. "1", "4", "6"). Αν φτιάξεις 10 διαφορετικά νέα tasks, το JSON σου ΠΡΕΠΕΙ να περιέχει 10 φορές την εγγραφή "task_id": "NEW". Μην ανησυχείς για διπλοτυπίες στο ID, το Backend μας θα τα διαχωρίσει από το 'task_name'.
4. SKIP ALREADY LOGGED: Αν ένα μήνυμα έχει την ετικέτα "(ALREADY LOGGED - SKIP)", ΜΗΝ παράγεις JSON γι' αυτό. Αγνόησέ το τελείως.
5. ONE-TO-ONE MAPPING (CRITICAL): Κάθε μήνυμα που ΔΕΝ γράφει SKIP, ΠΡΕΠΕΙ να έχει τη δική του αποκλειστική εγγραφή στο JSON entries. Απαγορεύεται να ομαδοποιείς πολλά μηνύματα σε μία εγγραφή. Αν ένα μήνυμα είναι απλή απάντηση, βάλε status 6, αλλά ΠΡΕΠΕΙ να υπάρχει ως γραμμή.
6. THE BALL RULE (STATUS 3 vs 4): 
   - Αν το μήνυμα είναι από τον Consultant (Datalink) και περιέχει ερώτηση προς τον πελάτη (π.χ. "Δέχεται άλλη αλλαγή;", "Ποιο έτος είναι;"), τότε είναι ΥΠΟΧΡΕΩΤΙΚΑ Status 3. 
   - Ποτέ μην βάζεις Status 4 όταν η Datalink περιμένει απάντηση για να μπορέσει να δουλέψει.
7. MULTIPLE TASKS IN ONE THREAD (CRITICAL): Ένα email thread έχει συχνά ΠΟΛΛΑ ΔΙΑΦΟΡΕΤΙΚΑ tasks. ΜΗΝ τα βάζεις όλα κάτω από το ίδιο 'task_name'. Όταν η συζήτηση αλλάζει θέμα, ΦΤΙΑΞΕ ΝΕΟ 'task_name'.

---
ΕΝΕΡΓΑ TASKS ΣΤΗ ΒΑΣΗ (Context):
{CONTEXT}

<user_messages>
{DATA}
</user_messages>
---

ΑΥΣΤΗΡΟ FORMAT ΕΞΟΔΟΥ (ΠΑΡΑΔΕΙΓΜΑ ΜΕ 3 ΔΙΑΦΟΡΕΤΙΚΑ ΝΕΑ TASKS):
{
  "debug_rules_received": "ΚΑΝΕ COPY-PASTE ΤΟΥΣ 7 ΑΠΑΡΑΒΑΤΟΥΣ ΚΑΝΟΝΕΣ ΕΔΩ",
  "action": "LOG_TASK",
  "entries": [
    { "msg_index": 1, "task_id": "NEW", "task_name": "Το Πρώτο Θέμα της Συζήτησης", "status_id": 1, "reason": "..." },
    { "msg_index": 2, "task_id": "NEW", "task_name": "Το Πρώτο Θέμα της Συζήτησης", "status_id": 3, "reason": "..." },
    { "msg_index": 3, "task_id": "NEW", "task_name": "Δεύτερο, Εντελώς Διαφορετικό Θέμα", "status_id": 2, "reason": "..." },
    { "msg_index": 4, "task_id": "NEW", "task_name": "Τρίτο Θέμα που Προέκυψε", "status_id": 1, "reason": "..." }
  ]
}`;
}



function runAIServer(threadId, mode) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    const messages = thread.getMessages();
    
    // Συγκέντρωση όλου του κειμένου για το Gemini
    const fullText = messages.map(m => {
      return "ΑΠΟ: " + m.getFrom() + "\nΗΜΕΡΟΜΗΝΙΑ: " + m.getDate() + "\nΚΕΙΜΕΝΟ:\n" + m.getPlainBody();
    }).join("\n---\n");

    const prompt = (mode === 'tasks' || mode === 'recreate') ? getGlobalPrompt() : getBaseSystemPrompt();
    const response = callGemini(fullText, prompt);
    
    // ΒΗΜΑ 2: Αποθήκευση αν ζητήθηκαν tasks
    if ((mode === 'tasks' || mode === 'recreate') && !response.includes("Error")) {
      processAIResponseAndStore(threadId, response);
    }

    return response;
  } catch (e) {
    console.error("Error in runAIServer:", e.message);
    return "❌ Σφάλμα Server: " + e.message;
  }
}

/**
 * ΒΗΜΑ 2: processAIResponseAndStore
 * Καθαρίζει τα παλιά tasks και αποθηκεύει τα νέα στη BigQuery.
 */
function processAIResponseAndStore(threadId, aiResponse) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  const tableId = 'task_lines';

  try {
    // Διαγραφή παλιών εγγραφών για αποφυγή διπλότυπων
    const deleteSql = "DELETE FROM `" + projectId + "." + datasetId + "." + tableId + "` WHERE message_id = '" + threadId + "'";
    try {
      BigQuery.Jobs.query({ query: deleteSql, useLegacySql: false }, projectId);
    } catch (e) { console.warn("No previous tasks found to delete."); }

    // Εξαγωγή tasks από την απάντηση (γραμμές που ξεκινούν με - ή *)
    const lines = aiResponse.split('\n');
    const tasks = [];
    lines.forEach(line => {
      let clean = line.trim();
      if (clean.startsWith('- ') || clean.startsWith('* ')) {
        tasks.push(clean.replace(/^[-*\s]+/, ''));
      }
    });

    if (tasks.length === 0) return;

    // Προετοιμασία για BigQuery
    const rows = tasks.map(taskName => {
      return {
        json: {
          message_id: threadId,
          task_name: taskName, // Σιγουρέψου ότι η στήλη στη BQ λέγεται task_name
          status_id: 1, 
          updated_at: new Date().toISOString()
        }
      };
    });

    BigQuery.Tabledata.insertAll({ rows: rows }, projectId, datasetId, tableId);
  } catch (e) {
    console.error("Storage error: " + e.message);
  }
}

/**
 * Η επικαιροποιημένη callGemini ρυθμισμένη για το μοντέλο gemini-2.0-flash.
 * Επιλύει το σφάλμα 404 και βελτιώνει την ακρίβεια της ανάλυσης.
 */
function callGemini(content, systemInstruction) {
  // Χρήση του gemini-2.0-flash όπως υποδεικνύουν τα logs σου
  const modelName = "gemini-2.0-flash"; 
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + API_KEY;
  
  const payload = {
    "system_instruction": {
      "parts": [{ "text": systemInstruction }]
    },
    "contents": [
      { "parts": [{ "text": content }] }
    ],
    "safetySettings": [
      { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
    ],
    "generationConfig": {
      "temperature": 0.15, // Χαμηλότερο temperature για αυστηρά δομημένη HTML και tasks
      "topP": 0.8,
      "topK": 40,
      "maxOutputTokens": 2048
    }
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const resText = response.getContentText();
    const resJson = JSON.parse(resText);
    
    if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content) {
      return resJson.candidates[0].content.parts[0].text;
    } else {
      console.error("Gemini Error Detail: " + resText);
      if (resJson.error) {
        return "❌ Σφάλμα API (" + resJson.error.code + "): " + resJson.error.message;
      }
      return "❌ Το AI δεν επέστρεψε αποτέλεσμα. Ελέγξτε τα Safety Settings.";
    }
  } catch (e) {
    console.error("Fetch Critical Error: " + e.message);
    return "❌ Σφάλμα σύνδεσης με τον εξυπηρετητή AI: " + e.message;
  }
}

function checkMyModels() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + API_KEY;
  try {
    const response = UrlFetchApp.fetch(url);
    const models = JSON.parse(response.getContentText());
    console.log("--- ΔΙΑΘΕΣΙΜΑ ΜΟΝΤΕΛΑ ΓΙΑ ΤΟ ΚΛΕΙΔΙ ΣΟΥ ---");
    models.models.forEach(m => {
      console.log("Όνομα: " + m.name + " | Methods: " + m.supportedGenerationMethods);
    });
  } catch (e) {
    console.error("Σφάλμα ελέγχου: " + e.message);
  }
}


function deleteTasksForThread(tid) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  
  // SQL Query για ολικό καθαρισμό των γραμμών του συγκεκριμένου thread
  const sql = `DELETE FROM \`${projectId}.${datasetId}.task_lines\` WHERE thread_id = '${tid}'`;
  
  try {
    // Εκτέλεση του Delete Job
    BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    
    return "✅ Τα tasks διαγράφηκαν επιτυχώς από τη BigQuery.";
  } catch (e) {
    console.error("Delete Error: " + e.message);
    return "❌ Σφάλμα κατά τη διαγραφή: " + e.message;
  }
}

function testConnection() {
  try {
    const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    console.log("Το κλειδί που διάβασα είναι: " + (key ? "Βρέθηκε (OK)" : "ΔΕΝ ΒΡΕΘΗΚΕ"));
    
    if (!key) {
      console.error("Σφάλμα: Το API_KEY είναι κενό στα Script Properties!");
      return;
    }

    // Δοκιμαστική κλήση στο Gemini
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + key;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
      muteHttpExceptions: true
    });
    
    console.log("Απάντηση Google: " + response.getResponseCode());
    console.log("Body: " + response.getContentText());
  } catch (e) {
    console.error("DEBUG ERROR: " + e.toString());
  }
}



// function getBulkMailTaskQueue(messageIds, threadId) {
//   const projectId = 'gen-lang-client-0465952145';
//   const datasetId = 'summy_logs';
  
//   // Αν δεν έχουμε IDs ή threadId, επιστρέφουμε άδειο αντικείμενο αμέσως
//   if (!messageIds || messageIds.length === 0 || !threadId) return {};
  
//   try {
//     const sql = `
//       SELECT 
//         tl.message_id, 
//         t.task_name, 
//         ts.status_name, 
//         tl.status_id, 
//         tl.updated_at
//       FROM \`${projectId}.${datasetId}.task_lines\` tl
//       LEFT JOIN \`${projectId}.${datasetId}.tasks\` t ON tl.task_id = t.task_id
//       LEFT JOIN \`${projectId}.${datasetId}.task_status\` ts ON tl.status_id = ts.status_id
//       WHERE tl.thread_id = '${threadId}'
//       ORDER BY tl.updated_at DESC
//     `;
    
//     const res = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
//     const results = {};
    
//     // Αρχικοποίηση όλων των messageIds με άδειο array
//     messageIds.forEach(id => { results[id] = []; });
    
//     if (res.rows) {
//       res.rows.forEach(r => {
//         const mId = r.f[0].v;
//         if (results[mId]) {
//           results[mId].push({
//             task: r.f[1].v,
//             status: r.f[2].v || "Pending",
//             sId: r.f[3].v,
//             // Format ώρας Ελλάδος
//             date: r.f[4].v ? Utilities.formatDate(new Date(Number(r.f[4].v)), "Europe/Athens", "HH:mm") : ""
//           });
//         }
//       });
//     }
//     return results; 
    
//   } catch(e) { 
//     console.error("BQ Query Error (getBulkMailTaskQueue): " + e.message);
//     return {}; 
//   }
// }

function getBulkMailTaskQueue(messageIds, threadId) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';
  
  // LOG 1: Να δούμε αν όντως ξεκινάει αυτή η συνάρτηση
  console.log("🔍 Checking BQ for Thread: " + threadId + " | Messages: " + (messageIds ? messageIds.length : 0));

  if (!messageIds || messageIds.length === 0 || !threadId) return {};
  
  try {
    const sql = `
      SELECT 
        tl.message_id, 
        t.task_name, 
        ts.status_name, 
        tl.status_id, 
        tl.updated_at
      FROM \`${projectId}.${datasetId}.task_lines\` tl
      LEFT JOIN \`${projectId}.${datasetId}.tasks\` t ON tl.task_id = t.task_id
      LEFT JOIN \`${projectId}.${datasetId}.task_status\` ts ON tl.status_id = ts.status_id
      WHERE tl.thread_id = '${threadId}'
      ORDER BY tl.updated_at DESC
    `;
    
    const res = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, projectId);
    const results = {};
    
    messageIds.forEach(id => { results[id] = []; });
    
    if (res.rows) {
      res.rows.forEach(r => {
        const mId = r.f[0].v;
        if (results[mId]) {
          results[mId].push({
            task: r.f[1].v,
            status: r.f[2].v || "Pending",
            sId: r.f[3].v,
            // ΔΙΟΡΘΩΣΗ: Τα timestamps της BQ είναι σε δευτερόλεπτα, οπότε θέλουν * 1000
            date: r.f[4].v ? Utilities.formatDate(new Date(Number(r.f[4].v) * 1000), "Europe/Athens", "HH:mm") : ""
          });
        }
      });
    }
    console.log("✅ BQ Search Finished for thread: " + threadId);
    return results; 
    
  } catch(e) { 
    // Αλλάζω το κείμενο εδώ για να είμαστε σίγουροι ότι βλέπουμε ΤΟΝ ΚΑΙΝΟΥΡΓΙΟ κώδικα στα logs
    console.error("🚨 NEW_CODE_ERROR (getBulkMailTaskQueue): " + e.message);
    return {}; 
  }
}


function runTasksPrompt(threadId) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) throw new Error("Thread not found: " + threadId);

    const messages = thread.getMessages();
    
    // ΚΡΙΣΙΜΟ: Χρήση .getId() για να έχουμε έγκυρα IDs μηνυμάτων
    const mIds = messages.map(m => m.getId());

    // 1. Φέρνουμε τα υπάρχοντα tasks από τη BQ
    const existingTasksMap = getBulkMailTaskQueue(mIds, threadId); 
    
    // 2. Προετοιμασία κειμένου για την AI με σήμανση SKIP/ANALYZE
    const fullText = messages.map((m, index) => {
      const mId = m.getId();
      const hasTasks = existingTasksMap[mId] && existingTasksMap[mId].length > 0;
      const statusLabel = hasTasks ? "--- (ALREADY LOGGED - SKIP) ---" : "--- (NEW MESSAGE - ANALYZE) ---";
      
      return `${statusLabel}
ΑΠΟ: ${m.getFrom()}
ΗΜΕΡΟΜΗΝΙΑ: ${m.getDate()}
ΜΗΝΥΜΑ #${index + 1}:
${m.getPlainBody()}`;
    }).join("\n\n---\n\n");

    // Λήψη του Prompt και κλήση Gemini
    const systemPrompt = getTasksPrompt(); 
    const response = callGemini(fullText, systemPrompt);
    
    // 3. Αποθήκευση των αποτελεσμάτων
    if (response && !response.includes("❌ Σφάλμα")) {
      StoreTasks(threadId, response);
    }

    return response;
    
  } catch (e) {
    console.error("Σφάλμα στη runTasksPrompt: " + e.message);
    return "❌ Σφάλμα από runTasksPrompt: " + e.message;
  }
}

function StoreTasks(threadId, aiResponse) {
  const projectId = 'gen-lang-client-0465952145';
  const datasetId = 'summy_logs';

  try {
    // 1. Καθαρισμός και Parsing του JSON από την AI
    const cleanJson = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanJson);
    if (!data.entries || !Array.isArray(data.entries)) return;

    const thread = GmailApp.getThreadById(threadId);
    if (!thread) return;
    
    const messages = thread.getMessages();
    
    // Χρήση των βοηθητικών συναρτήσεων που υπάρχουν ήδη στον κώδικά σου
    const customer = getClientDomain(thread); 
    const consultant = extractConsultant(thread);

    // 2. Εύρεση του Max Task ID για τα νέα tasks (NEW)
    let currentMaxId = 100;
    const maxRes = BigQuery.Jobs.query({ 
      query: `SELECT MAX(task_id) FROM \`${projectId}.${datasetId}.tasks\``, 
      useLegacySql: false 
    }, projectId);
    
    if (maxRes.rows && maxRes.rows[0].f[0].v) {
      currentMaxId = parseInt(maxRes.rows[0].f[0].v);
    }

    const taskMap = {};
    const newTasksSQL = [];
    const newLinesSQL = [];
    const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n|\r/g, " ");

    data.entries.forEach(entry => {
      // Μετατροπή msg_index (1-based από την AI) σε index πίνακα (0-based)
      const idx = parseInt(entry.msg_index) - 1;
      
      if (messages[idx]) {
        const mId = messages[idx].getId(); // Χρήση της σωστής μεθόδου .getId()
        let tId = entry.task_id;
        const tName = esc(entry.task_name);

        // Διαχείριση νέων tasks
        if (tId === "NEW") {
          if (!taskMap[tName]) {
            currentMaxId++;
            taskMap[tName] = currentMaxId;
            newTasksSQL.push(`(${currentMaxId}, '${tName}')`);
          }
          tId = taskMap[tName];
        }

        // Προετοιμασία της γραμμής για το task_lines
        if (mId) {
          newLinesSQL.push(`('${mId}', '${threadId}', ${tId}, ${entry.status_id}, '${esc(customer)}', '${esc(consultant)}', CURRENT_TIMESTAMP())`);
        }
      }
    });

    // 3. Εκτέλεση των Queries στη BigQuery
    if (newTasksSQL.length > 0) {
      const sqlTasks = `INSERT INTO \`${projectId}.${datasetId}.tasks\` (task_id, task_name) VALUES ${newTasksSQL.join(",")}`;
      BigQuery.Jobs.query({ query: sqlTasks, useLegacySql: false }, projectId);
    }
    
    if (newLinesSQL.length > 0) {
      const sqlLines = `INSERT INTO \`${projectId}.${datasetId}.task_lines\` (message_id, thread_id, task_id, status_id, customer_name, consultant_name, updated_at) VALUES ${newLinesSQL.join(",")}`;
      BigQuery.Jobs.query({ query: sqlLines, useLegacySql: false }, projectId);
      console.log("✅ Επιτυχής εγγραφή " + newLinesSQL.length + " γραμμών στη BQ.");
    }

  } catch (e) {
    console.error("CRITICAL StoreTasks Error: " + e.message);
  }
}