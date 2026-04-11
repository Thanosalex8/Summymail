# 📧 SummyMail Pro

> **AI-Powered Gmail Secretary** > Ο προσωπικός σου βοηθός τεχνητής νοημοσύνης που μετατρέπει το χάος των email σε καθαρές, δομημένες συνόψεις σε δευτερόλεπτα.

---

## 🌟 Επισκόπηση
Το **SummyMail Pro** είναι ένα backend σύστημα βασισμένο σε **Google Apps Script** που γεφυρώνει το Gmail με το **Google Gemini AI**. Αναλύει τα εισερχόμενα μηνύματα, αναγνωρίζει τα σημαντικά σημεία και παρέχει άμεση ενημέρωση στον χρήστη, εξοικονομώντας ώρες καθημερινής εργασίας.

## 🚀 Κύρια Χαρακτηριστικά
* **Gemini 2.0 Flash Integration:** Χρήση του πιο σύγχρονου μοντέλου της Google για μέγιστη ταχύτητα και ακρίβεια.
* **Έξυπνες Συνόψεις:** Αυτόματη εξαγωγή βασικών πληροφοριών από μεγάλα email threads.
* **Zero Infrastructure:** Τρέχει εξ ολοκλήρου στις υποδομές της Google (Apps Script) χωρίς κόστος φιλοξενίας.
* **Automated Workflow:** Πλήρως ενσωματωμένο workflow με VS Code για γρήγορο deployment.

## 🛠️ Τεχνικό Stack
* **Engine:** Google Apps Script (JavaScript V8)
* **AI Model:** [Google Gemini 2.0 Flash](https://aistudio.google.com/)
* **Management:** [Clasp](https://github.com/google/clasp) (Command Line Apps Script Projects)
* **Version Control:** Git & GitHub

## ⚙️ Ρυθμίσεις & Εγκατάσταση
Για τη λειτουργία του backend, απαιτούνται οι εξής ρυθμίσεις στα **Script Properties**:

| Property | Περιγραφή |
| :--- | :--- |
| `GEMINI_API_KEY` | Το προσωπικό σας API Key από το Google AI Studio |

## 🔄 Workflow Ανάπτυξης (Maintenance Mode)
Το project χρησιμοποιεί ένα αυτοματοποιημένο σύστημα "Push & Timestamp" μέσω VS Code:
1.  **Auto-timestamping:** Κατά το push, ενημερώνεται αυτόματα η έκδοση (`Version`) μέσα στα σχόλια του `Code.gs`.
2.  **Git Backup:** Ταυτόχρονο ανέβασμα στο GitHub για πλήρες ιστορικό αλλαγών.
3.  **Clasp Deployment:** Άμεση αποστολή του κώδικα στο Google Cloud.

---

## 🛡️ Κατάσταση Συντήρησης
**STRICT MAINTENANCE MODE: ON** *Ο κώδικας θεωρείται σταθερός. Ο σχεδιασμός (Visuals) και η βασική λογική είναι τελικά και δεν επιδέχονται αλλαγών χωρίς ρητή εντολή.*

---
*Developed by Thanos Alexandris | 2026*
