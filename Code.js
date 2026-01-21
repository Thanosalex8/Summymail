// 21-01-2026 16:05
const API_KEY = "AIzaSyDJLPiYsPRLDwi0jqPdYFuZnB8s9jDvl_s"; 
const MODEL_NAME = "models/gemini-2.0-flash";
const FOLDER_ID = "1xBKm0U79cnWQj3oTsNVz63HH65fgv-my"; 

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
      .setTitle('SummyMail App')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'); 
}

function getBaseSystemPrompt() {
  return `Ανάλυσε την παρακάτω συνομιλία Support/SoftOne. Ο ρόλος σου είναι Senior Consultant.
Απάντησε ΑΥΣΤΗΡΑ και ΜΟΝΟ με HTML κώδικα.

<div class="ai-response-container">
  <div class="ai-card summary-card"><div class="ai-card-header">📝 Σύνοψη</div><div class="ai-card-body">[Σύντομη περιγραφή]</div></div>
  <div class="ai-card client-card">
    <div class="ai-card-header">📄 Ανάλυση Εργασιών (Για Πελάτη)</div>
    <div class="ai-card-body"><ul><li>[Ανάλυση σε bullets]</li></ul></div>
  </div>
  <div class="ai-stats-row">
     <div class="stat-item">⏱️ Χρόνος: [Χ]</div>
     <div class="stat-item">💶 Κόστος: [Χ €]</div>
  </div>
</div>`;
}

function getAiSummary(threadId, customInstruction) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    const text = thread.getMessages().slice(-4).map(m => m.getPlainBody().substring(0, 2000)).join("\n---\n");
    const url = `https://generativelanguage.googleapis.com/v1beta/${MODEL_NAME}:generateContent?key=${API_KEY}`;
    const fullPrompt = getBaseSystemPrompt() + "\n\nΟΔΗΓΙΑ: " + (customInstruction || "Ανάλυση") + "\n\nTEXT:\n" + text;
    const payload = { contents: [{ parts: [{ text: fullPrompt }] }] };
    const res = UrlFetchApp.fetch(url, {method:"post", contentType:"application/json", payload:JSON.stringify(payload)});
    return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text.replace(/```html/g, '').replace(/```/g, '');
  } catch (e) { return "⚠️ Σφάλμα AI"; }
}

function generateQuickReport(p1, p2, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setDate(end.getDate() + 1);
  let threads = GmailApp.search(`after:${Utilities.formatDate(start, "GMT", "yyyy/MM/dd")} before:${Utilities.formatDate(end, "GMT", "yyyy/MM/dd")}`, 0, 100);
  
  let allThreads = [];
  threads.forEach(thread => {
    let msgs = thread.getMessages();
    let participants = msgs.map(m => m.getFrom().toLowerCase()).join(" ");
    let recipients = msgs.map(m => (m.getTo() + " " + m.getCc()).toLowerCase()).join(" ");
    let fullBodyText = msgs.map(m => m.getPlainBody().toLowerCase()).join(" ");

    if (!participants.includes("support@datalink") && !recipients.includes("support@datalink")) return;

    let consultant = "⚠️ Unassigned"; 
    if (participants.includes("tolis") || fullBodyText.includes("τόλης") || fullBodyText.includes("tolis")) consultant = "Tolis";
    else if (participants.includes("thimios") || participants.includes("tkounenis") || fullBodyText.includes("θύμιος") || fullBodyText.includes("thimios") || fullBodyText.includes("kounenis")) consultant = "Thymios";
    else if (participants.includes("nikos") || participants.includes("nikonst") || fullBodyText.includes("νίκος") || fullBodyText.includes("nikos")) consultant = "Nikos";
    else if (participants.includes("alex@datalink") || participants.includes("alex.") || participants.includes("me@") || fullBodyText.includes("αλεξανδρής") || fullBodyText.includes("alexandris") || fullBodyText.includes("θάνος") || fullBodyText.includes("thanos")) consultant = "Thanos";
    
    allThreads.push({
      id: thread.getId(),
      consultant: consultant,
      client: getClientDomain(thread),
      lastUpdate: thread.getLastMessageDate().getTime(),
      subject: thread.getFirstMessageSubject(),
      messages: msgs.map((m, i) => ({
        id: m.getId(),
        from: m.getFrom().split('<')[0],
        timestamp: Utilities.formatDate(m.getDate(), "Europe/Athens", "dd/MM HH:mm"),
        diff: getTimeDiff(m.getDate(), i > 0 ? msgs[i-1].getDate() : null),
        body: cleanBody(m.getPlainBody())
      }))
    });
  });
  return allThreads;
}

function cleanBody(text) {
  if (!text) return "";
  let body = text.split(/^(On\s.*wrote:|Στις\s.*έγραψε:|From:|Sent:|To:|Subject:|-----Original Message-----|________________________________)/m)[0].trim();
  let lines = body.split('\n');
  let cleanLines = [];
  const closings = ["best regards", "kind regards", "regards", "thanks", "με εκτίμηση", "φιλικά", "ευχαριστώ", "best,", "at your disposal"];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) { cleanLines.push(""); continue; }
    if (line.toLowerCase().includes("disclaimer") || line.toLowerCase().includes("confidential")) break;
    if (closings.some(c => line.toLowerCase().startsWith(c))) {
      cleanLines.push(""); cleanLines.push(line);
      if (i + 1 < lines.length) cleanLines.push(lines[i+1].trim());
      break; 
    }
    cleanLines.push(line);
  }
  return cleanLines.join('<br>').replace(/(<br>\s*){3,}/g, '<br><br>').trim();
}

/**
 * ΔΙΟΡΘΩΣΗ ΕΙΚΟΝΩΝ: CID + Filename σε Base64
 */
function getFullEmailContent(msgId) {
  try {
    const msg = GmailApp.getMessageById(msgId);
    let htmlBody = msg.getBody();
    const attachments = msg.getAttachments({includeInlineImages: true});
    
    attachments.forEach(att => {
      const contentType = att.getContentType();
      if (contentType.indexOf("image/") !== -1) {
        const b64 = Utilities.base64Encode(att.getBytes());
        const dataUrl = "data:" + contentType + ";base64," + b64;
        
        // 1. Έλεγχος CID (Content-ID)
        if (typeof att.getContentId === 'function') {
          const cid = att.getContentId();
          if (cid) {
            const regexCid = new RegExp('src="cid:' + cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
            htmlBody = htmlBody.replace(regexCid, 'src="' + dataUrl + '"');
          }
        }
        
        // 2. Έλεγχος Filename (για περιπτώσεις όπως στο screenshot)
        const name = att.getName();
        if (name) {
          const regexName = new RegExp('src="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
          htmlBody = htmlBody.replace(regexName, 'src="' + dataUrl + '"');
        }
      }
    });
    return { success: true, body: htmlBody };
  } catch (e) {
    return { success: false, body: "Σφάλμα: " + e.toString() };
  }
}

function getReportContent(fileId) {
  try {
    let html = DriveApp.getFileById(fileId).getBlob().getDataAsString();
    let clean = html.split('<div class="card" id="finalReport">')[1].split('</div><button id="saveBtn"')[0];
    return { html: '<div class="card" id="finalReport">' + clean + '</div>' };
  } catch (e) { return { html: "" }; }
}

function saveToDrive(html, person) {
  const name = `${Utilities.formatDate(new Date(), "Europe/Athens", "dd-MM-yyyy HH:mm")} - Report ${person}.html`;
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
  while (files.hasNext()) { let f = files.next(); list.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().getTime() }); }
  return list; 
}
// 21-01-2026 16:05