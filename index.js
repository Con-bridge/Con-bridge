// Importa i moduli della v2 di Firebase Functions
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

// Inizializza l'app Admin
initializeApp();

/**
 * Triggerata alla creazione di una nuova comunicazione.
 * Invia una notifica push agli utenti target.
 */
exports.sendNewCommunicationNotification = onDocumentCreated("communications/{commId}", async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("Nessun dato associato all'evento.");
        return;
    }
    const communication = snap.data();

    const payload = {
        notification: {
            title: "Nuova Comunicazione in Bacheca",
            body: `"${communication.title}"`,
            icon: "/Con-bridge/icons/icon-192x192.png",
        },
        data: {
            url: "/Con-bridge/", // Pagina da aprire al click
            type: "communication",
        },
    };

    // Recupera i token di tutti gli utenti
    const db = getFirestore();
    const tokensSnapshot = await db.collection("fcmTokens").get();
    if (tokensSnapshot.empty) {
        console.log("Nessun token trovato per inviare notifiche.");
        return;
    }

    // Estrai tutti i token da tutti i documenti
    const allTokens = [];
    tokensSnapshot.forEach((doc) => {
        const userTokens = doc.data().tokens;
        if (Array.isArray(userTokens)) {
            allTokens.push(...userTokens);
        }
    });

    if (allTokens.length === 0) {
        console.log("La lista di token è vuota.");
        return;
    }

    console.log(`Invio notifica a ${allTokens.length} token.`);

    try {
        // Invia il messaggio a tutti i token
        const messaging = getMessaging();
        const response = await messaging.sendToDevice(allTokens, payload);
        console.log("Notifiche inviate con successo:", response.successCount);
    } catch (error) {
        console.error("Errore nell'invio delle notifiche:", error);
    }
});


/**
 * Triggerata quando un ticket viene marcato come urgente (sollecito).
 */
exports.sendUrgentReportNotification = onDocumentUpdated("reports/{reportId}", async (event) => {
    if (!event.data) {
        console.log("Nessun dato nell'evento.");
        return;
    }

    const before = event.data.before.data();
    const after = event.data.after.data();

    // Controlla se il campo 'isUrgent' è appena diventato 'true'
    if (before.isUrgent !== true && after.isUrgent === true) {
        console.log(`Sollecito per segnalazione #${after.reportNumber}`);

        const payload = {
            notification: {
                title: "⚠️ Sollecito Segnalazione Urgente",
                body: `Hai ricevuto un sollecito per la segnalazione: "${after.title}"`,
                icon: "/Con-bridge/icons/icon-192x192.png",
            },
            data: {
                url: "/Con-bridge/", // Potresti puntare a una pagina specifica
                type: "sollecito",
            },
        };

        // Determina a chi inviare la notifica
        const recipientRole = after.recipientType; // es. 'amministratore'
        if (!recipientRole) {
            console.log("Destinatario non specificato, notifica non inviata.");
            return;
        }

        const db = getFirestore();
        // Trova gli utenti con quel ruolo
        const usersSnapshot = await db.collection("users")
            .where("tipoUtente", "==", recipientRole).get();

        if (usersSnapshot.empty) {
            console.log(`Nessun utente con ruolo '${recipientRole}' trovato.`);
            return;
        }

        const userIds = usersSnapshot.docs.map((doc) => doc.id);

        // Recupera i token per questi utenti
        const tokensPromises = userIds.map((uid) =>
            db.collection("fcmTokens").doc(uid).get(),
        );
        const tokensDocs = await Promise.all(tokensPromises);

        const tokens = tokensDocs
            .filter((doc) => doc.exists && doc.data().tokens)
            .flatMap((doc) => doc.data().tokens);

        if (tokens.length > 0) {
            console.log(`Invio sollecito a ${tokens.length} token.`);
            const messaging = getMessaging();
            await messaging.sendToDevice(tokens, payload);
        } else {
            console.log("Nessun token trovato per i destinatari del sollecito.");
        }
    }
});