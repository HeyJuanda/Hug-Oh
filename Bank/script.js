import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, runTransaction, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, where, getDocs, arrayUnion, deleteDoc, getDocs as getDocsFn } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ---------- CONFIG ----------
const firebaseConfig = {
    apiKey: "AIzaSyBXEUi90NNMxJv2ovdQG_g7yWE77bhSVd8",
    authDomain: "hug-ds.firebaseapp.com",
    projectId: "hug-ds",
    storageBucket: "hug-ds.firebasestorage.app",
    messagingSenderId: "1063721214850",
    appId: "1:1063721214850:web:8a0ae2bc10a222be19659b",
    measurementId: "G-DXQF1K2R43"
};

// Use fixed artifacts prefix to avoid confusión del appId dinámico
const ARTIFACTS_PREFIX = 'artifacts/default-app-id';

// Sanitizar apiKey
if (typeof firebaseConfig.apiKey === 'string') {
    firebaseConfig.apiKey = firebaseConfig.apiKey.trim();
}

// Inicialización silenciosa
window.__firebaseInitError = null;

let app = null;
let auth = null;
let db = null;

try {
    app = initializeApp(firebaseConfig);

    // Asegurar projectId en app.options para Firestore
    try {
        if (app && (!app.options || !app.options.projectId)) {
            app.options = Object.assign({}, app.options || {}, { projectId: firebaseConfig.projectId });
        }
    } catch (inner) {
        window.__firebaseInitError = window.__firebaseInitError || { step: 'patchAppOptions', message: inner && inner.message ? inner.message : String(inner) };
    }
} catch (err) {
    window.__firebaseInitError = { step: 'initializeApp', message: err && err.message ? err.message : String(err) };
}

const FIXED_APP_ID = 'default-app-id'; // Expuesto pero NO se usa en rutas dinámicas

try {
    if (app) {
        try {
            auth = getAuth(app);
        } catch (err) {
            window.__firebaseInitError = { step: 'getAuth', message: err && err.message ? err.message : String(err) };
            auth = null;
        }

        try {
            if (!app.options || !app.options.projectId) {
                app.options = Object.assign({}, app.options || {}, { projectId: firebaseConfig.projectId });
            }
            db = getFirestore(app);
        } catch (err) {
            window.__firebaseInitError = { step: 'getFirestore', message: err && err.message ? err.message : String(err) };
            db = null;
        }
    } else {
        if (!window.__firebaseInitError) window.__firebaseInitError = { step: 'app_missing', message: 'Firebase app no inicializada' };
    }
} catch (err) {
    window.__firebaseInitError = { step: 'initAuthFirestore', message: err && err.message ? err.message : String(err) };
}

window.__hugBankFirebase = {
    app: app,
    auth: auth,
    db: db,
    appId: FIXED_APP_ID
};

// Helper: esperar Auth
async function waitForFirebaseAuth(timeoutMs = 7000) {
    const start = Date.now();
    while (true) {
        if (window.__firebaseInitError) throw new Error(window.__firebaseInitError.message || 'Firebase init error');
        const fb = window.__hugBankFirebase || {};
        if (fb.auth) {
            auth = fb.auth;
            return fb.auth;
        }
        if (Date.now() - start > timeoutMs) throw new Error('Timeout esperando Firebase Auth');
        await new Promise(r => setTimeout(r, 150));
    }
}

// ---------- APP LOGIC (UI references, helpers and functionality) ----------
let currentUser = null; 

let appId = 'default-app-id';

// --- REFERENCIAS DE UI ---
const views = {
    dashboard: document.getElementById('dashboard-view'),
    transfer: document.getElementById('transfer-view')
};
const messageBox = document.getElementById('message-box');
const transactionTypeSelect = document.getElementById('transaction-type');
const interestRateField = document.getElementById('interest-rate-field');
const transactionsList = document.getElementById('transactions-list');
const debtsList = document.getElementById('debts-list'); 
const creditScoreDisplay = document.getElementById('credit-score-display'); 
// Referencia UI para el nombre
const userNameDisplay = document.getElementById('user-name-display');

// [ADICIÓN: Referencias de UI para Solicitudes]
const loanRequestsList = document.getElementById('loan-requests-list');
const recipientIdInput = document.getElementById('recipient-id');
const recipientIdLabel = document.getElementById('recipient-id-label');
const transferSubmitBtn = document.getElementById('transfer-submit-btn');
// [/ADICIÓN: Referencias de UI para Solicitudes]

// Referencias de Inputs
const amountInput = document.getElementById('amount');
const interestInput = document.getElementById('interest');
// NUEVO: Referencia para la descripción
const descriptionInput = document.getElementById('description');


 // Referencias del Modal de Puntuación
const scoreModal = document.getElementById('score-modal');
const closeBtn = document.querySelector('.close-btn');
const scoreForm = document.getElementById('score-form');
const scoreModalRecipientName = document.getElementById('score-modal-recipient-name');
const scoreModalRecipientId = document.getElementById('score-modal-recipient-id');

// [ADICIÓN: Referencias para el Modal de Contactos]
const contactsModal = document.getElementById('contacts-modal');
const openContactsBtn = document.getElementById('open-contacts-btn');
const closeContactsModalBtn = document.getElementById('close-contacts-modal');
const addContactForm = document.getElementById('add-contact-form');
const contactUidInput = document.getElementById('contact-uid');
const contactsList = document.getElementById('contacts-list');

// --- UTILIDADES ---
function showMessage(message, type = 'success') {
    messageBox.textContent = message;
    messageBox.className = 'mt-4 p-4 rounded-lg text-sm transition-all duration-300';
    if (type === 'success') {
        messageBox.classList.add('bg-green-100', 'text-green-800');
    } else if (type === 'error') {
        messageBox.classList.add('bg-red-100', 'text-red-800');
    } else if (type === 'info') {
         messageBox.classList.add('bg-blue-100', 'text-blue-800');
    }
    messageBox.classList.remove('hidden');

    setTimeout(() => {
        messageBox.classList.add('hidden');
    }, 5000);
}

// Sistema de Confirmación Modal Moderno
const confirmModal = document.getElementById('confirm-modal');
const confirmModalIcon = document.getElementById('confirm-modal-icon');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel');
const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm');

let confirmResolve = null;

function showConfirmModal(title, message, type = 'warning') {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        confirmModalTitle.textContent = title;
        confirmModalMessage.innerHTML = message;
        
        // Cambiar icono y estilo según tipo
        confirmModalIcon.textContent = type === 'danger' ? '⚠️' : type === 'info' ? 'ℹ️' : '❓';
        confirmModalIcon.className = `confirm-modal-icon ${type === 'danger' ? 'danger' : type === 'info' ? 'info' : 'warning'}`;
        
        // Cambiar color del botón de confirmación
        if (type === 'danger') {
            confirmModalConfirmBtn.className = 'confirm-modal-btn confirm-modal-btn-confirm';
            confirmModalConfirmBtn.style.backgroundColor = '#ef4444';
        }

        confirmModal.classList.add('show');
    });
}

confirmModalCancelBtn.addEventListener('click', () => {
    confirmModal.classList.remove('show');
    if (confirmResolve) confirmResolve(false);
});

confirmModalConfirmBtn.addEventListener('click', () => {
    confirmModal.classList.remove('show');
    if (confirmResolve) confirmResolve(true);
});

// Cerrar modal si se hace clic fuera del contenido
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
        confirmModal.classList.remove('show');
        if (confirmResolve) confirmResolve(false);
    }
});

// Cerrar con ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmModal.classList.contains('show')) {
        confirmModal.classList.remove('show');
        if (confirmResolve) confirmResolve(false);
    }
});

function switchView(target) {
    Object.values(views).forEach(view => view.classList.add('hidden'));
    views[target].classList.remove('hidden');
}

// --- LÓGICA DE INTERÉS MÍNIMO DINÁMICO (CORREGIDO) ---

function getRequiredMinimumInterest(amount) {
    // Comisión: 5% (< $50), 8% ($50 <= x < $250), 10% (>= $250)
    if (amount >= 250) { 
        return 10;
    } else if (amount >= 50) { 
        return 8;
    } else if (amount > 0) {
        return 5;
    }
    return 5; // Default minimum
}

function updateMinimumInterest() {
    const transactionType = transactionTypeSelect.value;
    // Solo aplica para préstamos y solicitudes de préstamo
    if (transactionType === 'transfer') return; 

    const amount = parseFloat(amountInput.value) || 0;
    
    // Si el monto no es válido o es cero, establecer el mínimo a 5%
    const minInterest = getRequiredMinimumInterest(amount);

    // 1. Actualizar el atributo 'min' del campo de interés
    interestInput.setAttribute('min', minInterest.toString());

    // 2. Si el valor actual es menor que el nuevo mínimo, actualizar el valor
    let currentInterest = parseFloat(interestInput.value) || 0;
    if (currentInterest < minInterest) {
        interestInput.value = minInterest.toString();
    }
}
// --- FIN LÓGICA DE INTERÉS MÍNIMO DINÁMICO ---


// --- LÓGICA DEL MODAL DE PUNTUACIÓN ---
closeBtn.onclick = () => { scoreModal.style.display = 'none'; };
window.onclick = (event) => {
    if (event.target === scoreModal) {
        scoreModal.style.display = 'none';
    }
};

scoreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = parseInt(document.querySelector('input[name="rating"]:checked').value);
    const loanDocId = scoreForm.getAttribute('data-loan-doc-id');
    const recipientId = scoreForm.getAttribute('data-recipient-id');
    
    try {
        // 1. Se puntúa la deuda y el deudor
        await saveCreditScore(recipientId, rating);
        // 2. Se marca la transacción de prestamista como puntuado para no volver a salir el botón.
        await updateDoc(doc(db, `artifacts/${appId}/users/${currentUser.uid}/transactions/${loanDocId}`), { 
            scoreGiven: true, 
            score: rating 
        });
        
        showMessage('Puntuación enviada con éxito.', 'success');
        scoreModal.style.display = 'none';
        // Recargar el saldo y las transacciones para actualizar la UI
        loadBalance(currentUser.uid);
        listenToTransactions(currentUser.uid); // Forzar recarga de transacciones
    } catch (error) {
        console.error("Error al enviar puntuación:", error);
        showMessage(`Error al enviar puntuación: ${error.message}`, 'error');
    }
});

// --- MANEJO DE VISTAS Y EVENTOS ---

document.getElementById('show-transfer-btn').addEventListener('click', () => {
    switchView('transfer');
});

document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
    switchView('dashboard');
});

// [LISTENER: Ajustar el interés mínimo según el monto al escribir]
amountInput.addEventListener('input', updateMinimumInterest);

// [Lógica para ocultar/cambiar inputs en Transferir/Solicitar]
transactionTypeSelect.addEventListener('change', (e) => {
    const type = e.target.value;
    const isLoanRequest = type === 'loan-request';
    
    // Campo de Interés
    interestRateField.classList.toggle('hidden', type === 'transfer');
    
    // Campo de Receptor
    recipientIdInput.required = !isLoanRequest;
    recipientIdInput.value = isLoanRequest ? '' : recipientIdInput.value;
    recipientIdInput.disabled = isLoanRequest; // Deshabilitar si es solicitud
    recipientIdInput.placeholder = isLoanRequest ? 'Se genera automáticamente' : 'ID completo del usuario';
    recipientIdLabel.textContent = isLoanRequest ? 'ID del Solicitante (Eres tú)' : 'ID del Receptor';
    transferSubmitBtn.textContent = isLoanRequest ? 'Publicar Solicitud' : 'Confirmar';
    
    // Aplicar la lógica de mínimo de interés al cambiar el tipo de transacción
    if (type !== 'transfer') {
        updateMinimumInterest(); 
    } else {
         interestInput.setAttribute('min', '0'); // Restablecer mínimo para transferencias (aunque está oculto)
    }
});
// Inicializar el estado de la vista de transferencia/préstamo
transactionTypeSelect.dispatchEvent(new Event('change'));
// [/Lógica para ocultar/cambiar inputs en Transferir/Solicitar)

// --- FIREBASE AUTH Y ESTADO ---

// Updated logout handler: wait for auth to be ready before calling signOut
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        const authInst = await waitForFirebaseAuth().catch(err => { throw err; });
        await signOut(authInst);
        // Recargar para mostrar la vista de bienvenida
        window.location.reload(); 
    } catch (error) {
        console.error("Error al cerrar sesión:", error);
        showMessage('Error al cerrar sesión.', 'error');
    }
});

/*
    IMPORTANT FIX:
    onAuthStateChanged was being called with `auth` which can be null on some environments
    (e.g. when getAuth failed or SDK initialization was delayed). That caused:
      Uncaught TypeError: Cannot read properties of null (reading 'onAuthStateChanged')

    We now wait for Firebase Auth to be available using waitForFirebaseAuth() and only then
    attach the onAuthStateChanged listener. If it times out or there's an init error,
    we log the error and show a message to the user.
*/

// Wrap auth state listener setup in an async IIFE that waits for auth
(async function initAuthStateListener() {
    try {
        const authInst = await waitForFirebaseAuth();
        // Attach the listener using the resolved auth instance
        onAuthStateChanged(authInst, async (user) => {
            if (user && !user.isAnonymous) { // Solo usuarios autenticados con cuenta
                currentUser = user;
                document.getElementById('user-id-display').textContent = user.uid;
                
                // Cargar saldo inicial y configurar actualización en tiempo real
                await loadBalance(user.uid);
                setupRealtimeBalance(user.uid);
                
                loadCreditScore(user.uid); // Cargar puntuación de crédito
                listenToTransactions(user.uid);
                // [ADICIÓN: Escuchar solicitudes de préstamo]
                listenToLoanRequests(user.uid);
                // [/ADICIÓN: Escuchar solicitudes de préstamo]
                // [ADICIÓN: Escuchar contactos]
                listenToContacts(user.uid);
                // [/ADICIÓN: Escuchar contactos]
                switchView('dashboard');
                document.getElementById('welcome-view').classList.add('hidden');
            } else if (user && user.isAnonymous) {
                // Si el usuario es anónimo (solo para entorno), cerrar sesión
                await signOut(authInst);
                document.getElementById('welcome-view').classList.remove('hidden');
            } else {
                currentUser = null;
                // Si no hay usuario, mostrar bienvenida
                document.getElementById('welcome-view').classList.remove('hidden');
            }
        });
    } catch (err) {
        console.error('Firebase Auth no disponible al inicializar listener:', err);
        // Mostrar mensaje amigable en UI para que el usuario sepa que hubo un problema de inicialización.
        showMessage('Error inicializando autenticación de Firebase. Intenta recargar la página.', 'error');
    }
})();

// [ADICIÓN: Función para resetear el score]
async function resetCreditScore(userId) {
    if (!userId) return;
    const COST = 5.00;
    const userAccountRef = doc(db, `artifacts/${appId}/users/${userId}/account/data`);
    
    const confirmed = await showConfirmModal(
        'Resetear Score Crediticio',
        `Se cobrará <strong>$${COST.toFixed(2)}</strong> de tu saldo para resetear tu historial a <strong>5.0 ★</strong>. ¿Deseas continuar?`,
        'warning'
    );

    if (!confirmed) {
        showMessage('Operación de reseteo de score cancelada.', 'info');
        return;
    }

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userAccountRef);
            if (!userDoc.exists()) throw new Error("Cuenta no encontrada.");

            const currentBalance = userDoc.data().balance;
            if (currentBalance < COST) throw new Error("Saldo insuficiente para pagar el reseteo.");

            // Descontar saldo
            const newBalance = currentBalance - COST;
            transaction.update(userAccountRef, { 
                balance: newBalance,
                creditScore: { average: 5.0, count: 0 } // Resetear score
            });
        });

        // Registrar transacción en historial (Salida de dinero)
        const userData = await getAccountData(userId);
        await createTransaction(userId, {
            amount: COST,
            senderId: userId,
            recipientId: 'HUG Bank',
            type: 'score-reset-fee',
            senderName: userData.name,
            recipientName: 'HUG Bank'
        }); 

        showMessage('¡Tu historial crediticio ha sido reseteado a 5.0 estrellas! Se descontaron $5.00 de tu saldo.', 'success');
        loadBalance(userId);
        loadCreditScore(userId);
        listenToTransactions(userId);
    } catch (e) {
        console.error("Fallo al resetear el score:", e);
        showMessage(`Fallo al resetear el score: ${e.message}`, 'error');
    }
}

document.getElementById('reset-score-btn').addEventListener('click', () => {
    if (currentUser) {
        resetCreditScore(currentUser.uid);
    }
});
// [/ADICIÓN: Función para resetear el score]


// --- FUNCIONES FIRESTORE ---

// *** CORRECCIÓN #1: Modificación de loadBalance para cargar el nombre desde Firestore y actualización en tiempo real.
function setupRealtimeBalance(userId) {
    if (!userId) return;
    const balanceDisplay = document.getElementById('balance-display');
    const userAccountRef = doc(db, `artifacts/${appId}/users/${userId}/account/data`);

    // Configurar listener en tiempo real para el saldo
    return onSnapshot(userAccountRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const balance = data.balance || 0;
            const oldBalance = parseFloat(balanceDisplay.textContent.replace('$', '')) || 0;

            // >> OBTENER Y MOSTRAR EL NOMBRE DESDE FIRESTORE <<
            userNameDisplay.textContent = data.name || 'Usuario';
            // Mostrar monto congelado si existe
            const held = data.held || 0;
            const frozenDisplay = document.getElementById('frozen-display');
            if (frozenDisplay) frozenDisplay.textContent = `Congelado: $${held.toFixed(2)}`;

            // Mostrar el saldo con animación si hay cambio
            if (balance !== oldBalance) {
                // Agregar clase para la animación
                balanceDisplay.classList.add('balance-update');

                // Determinar si es un incremento o decremento
                if (balance > oldBalance) {
                    balanceDisplay.classList.add('balance-increase');
                } else {
                    balanceDisplay.classList.add('balance-decrease');
                }

                // Actualizar el saldo
                balanceDisplay.textContent = `$${balance.toFixed(2)}`;

                // Remover clases de animación después de la transición
                setTimeout(() => {
                    balanceDisplay.classList.remove('balance-update', 'balance-increase', 'balance-decrease');
                }, 1000);
            } else {
                // Ensure the displayed balance is correct
                balanceDisplay.textContent = `$${balance.toFixed(2)}`;
            }
        } else {
            // Si llega aquí sin cuenta, forzamos la inicialización
            const fallbackName = currentUser && currentUser.displayName ? currentUser.displayName : 'Anónimo';
            setDoc(userAccountRef, {
                balance: 0.00,
                held: 0.00,
                name: fallbackName,
                email: currentUser ? (currentUser.email || 'N/A') : 'N/A',
                creditScore: { average: 5.0, count: 0 }
            });

            userNameDisplay.textContent = fallbackName;
            balanceDisplay.textContent = '$0.00';
            const frozenDisplay = document.getElementById('frozen-display');
            if (frozenDisplay) frozenDisplay.textContent = `Congelado: $0.00`;
        }
    }, (error) => {
        console.error("Error al cargar el saldo:", error);
        balanceDisplay.textContent = 'Error';
    });
}

// Función auxiliar para cargar el saldo inicial
async function loadBalance(userId) {
    if (!userId) return;
    try {
        const userAccountRef = doc(db, `artifacts/${appId}/users/${userId}/account/data`);
        const docSnap = await getDoc(userAccountRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const balance = data.balance;
            document.getElementById('balance-display').textContent = `$${balance.toFixed(2)}`;
            userNameDisplay.textContent = data.name || 'Usuario';
            const held = data.held || 0;
            const frozenDisplay = document.getElementById('frozen-display');
            if (frozenDisplay) frozenDisplay.textContent = `Congelado: $${held.toFixed(2)}`;
        }
    } catch (error) {
        console.error("Error al cargar el saldo inicial:", error);
    }
}

async function loadCreditScore(userId) {
     if (!userId) return;
     try {
        const userAccountRef = doc(db, `artifacts/${appId}/users/${userId}/account/data`);
        const docSnap = await getDoc(userAccountRef);
        if (docSnap.exists() && docSnap.data().creditScore) {
            const score = docSnap.data().creditScore;
            const rating = score.average.toFixed(1);
            creditScoreDisplay.textContent = `${rating} ★ (${score.count})`;
        } else {
            creditScoreDisplay.textContent = '5.0 ★ (0)';
        }
    } catch (error) {
        console.error("Error al cargar la puntuación de crédito:", error);
        creditScoreDisplay.textContent = 'Error';
    }
}

async function getAccountData(userId) {
     const userAccountRef = doc(db, `artifacts/${appId}/users/${userId}/account/data`);
     const docSnap = await getDoc(userAccountRef);
     if (docSnap.exists()) return docSnap.data();
     return null;
}

async function createTransaction(userId, transactionData) {
    const transactionsRef = collection(db, `artifacts/${appId}/users/${userId}/transactions`);
    return await addDoc(transactionsRef, { ...transactionData, timestamp: serverTimestamp() });
}

// --- [ADICIÓN: LÓGICA DE CONTACTOS] ---

// Añadir un contacto
async function addContact(userId, contactUid) {
    if (!userId || !contactUid || userId === contactUid) return;
    try {
        // Verificar que el contacto existe
        const contactData = await getAccountData(contactUid);
        if (!contactData) {
            showMessage(`El usuario con UID ${contactUid} no existe.`, 'error');
            return false;
        }
        
        const contactRef = doc(db, `artifacts/${appId}/users/${userId}/contacts/${contactUid}`);
        await setDoc(contactRef, {
            uid: contactUid,
            addedAt: serverTimestamp()
        });
        showMessage(`Contacto ${contactData.name} añadido.`, 'success');
        return true;
    } catch (error) {
        console.error("Error al añadir contacto:", error);
        showMessage(`Error al añadir contacto: ${error.message}`, 'error');
        return false;
    }
}

// Eliminar un contacto
async function deleteContact(userId, contactUid) {
    if (!userId || !contactUid) return;
    const confirmed = await showConfirmModal('Eliminar Contacto', '¿Estás seguro de que quieres eliminar este contacto?', 'danger');
    if (!confirmed) return;

    try {
        const contactRef = doc(db, `artifacts/${appId}/users/${userId}/contacts/${contactUid}`);
        await deleteDoc(contactRef);
        showMessage('Contacto eliminado.', 'info');
    } catch (error) {
        console.error("Error al eliminar contacto:", error);
        showMessage(`Error al eliminar contacto: ${error.message}`, 'error');
    }
}

// Escuchar y renderizar contactos
function listenToContacts(userId) {
    if (!userId) return;
    const contactsRef = collection(db, `artifacts/${appId}/users/${userId}/contacts`);
    const q = query(contactsRef, orderBy('addedAt', 'desc'));

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            contactsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No tienes contactos guardados.</p>';
            return;
        }

        contactsList.innerHTML = '<p class="text-gray-500 text-sm text-center">Cargando...</p>';
        let contactsHtml = '';
        
        for (const doc of snapshot.docs) {
            const contactUid = doc.id;
            const contactAccountData = await getAccountData(contactUid);
            
            if (contactAccountData) {
                const score = contactAccountData.creditScore?.average.toFixed(1) || '5.0';
                const scoreCount = contactAccountData.creditScore?.count || 0;
                
                contactsHtml += `
                    <div class="contact-item bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="font-semibold text-gray-800">${contactAccountData.name}</p>
                                <p class="text-xs text-gray-500 break-all">${contactUid}</p>
                                <p class="text-xs text-yellow-500 font-bold">Score: ${score} ★ (${scoreCount})</p>
                            </div>
                            <div class="flex gap-2">
                                <button class="select-contact-btn p-2 rounded-full bg-green-500 text-white text-xs" data-uid="${contactUid}" title="Seleccionar">✓</button>
                                <button class="delete-contact-btn p-2 rounded-full bg-red-500 text-white text-xs" data-uid="${contactUid}" title="Eliminar">×</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
        contactsList.innerHTML = contactsHtml || '<p class="text-gray-500 text-sm text-center">No se encontraron datos de contactos.</p>';
    });
}

// Listeners para el modal de contactos
openContactsBtn.addEventListener('click', () => contactsModal.classList.remove('hidden'));
closeContactsModalBtn.addEventListener('click', () => contactsModal.classList.add('hidden'));
contactsModal.addEventListener('click', (e) => {
    if (e.target === contactsModal) contactsModal.classList.add('hidden');
});

addContactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contactUid = contactUidInput.value.trim();
    if (contactUid && currentUser) {
        const success = await addContact(currentUser.uid, contactUid);
        if (success) {
            contactUidInput.value = '';
        }
    }
});

contactsList.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    const uid = target.dataset.uid;
    if (target.classList.contains('select-contact-btn')) {
        recipientIdInput.value = uid;
        contactsModal.classList.add('hidden');
    } else if (target.classList.contains('delete-contact-btn')) {
        if (currentUser) {
            deleteContact(currentUser.uid, uid);
        }
    }
});

// --- FIN LÓGICA DE CONTACTOS ---

// --- FUNCIÓN: Cancelar una solicitud pública de préstamo (propia) - TOP-LEVEL ---
async function cancelLoanRequest(requestDocId) {
    if (!currentUser) throw new Error('Usuario no autenticado.');
    if (!requestDocId) throw new Error('ID de solicitud inválido.');

    const requestRef = doc(db, `artifacts/${appId}/loan-requests/${requestDocId}`);
    try {
        await runTransaction(db, async (transaction) => {
            const reqDoc = await transaction.get(requestRef);
            if (!reqDoc.exists()) throw new Error('Solicitud no encontrada.');
            const data = reqDoc.data();
            // Solo el creador (debtorId) puede cancelar una solicitud pendiente
            if (data.debtorId !== currentUser.uid) throw new Error('No tienes permiso para cancelar esta solicitud.');
            if (data.status !== 'pending') throw new Error('Solo se pueden cancelar solicitudes pendientes.');

            transaction.update(requestRef, {
                status: 'cancelled',
                cancelledDate: serverTimestamp(),
                cancelledBy: currentUser.uid
            });
        });

        showMessage('Solicitud de préstamo cancelada correctamente.', 'success');
        return true;
    } catch (e) {
        console.error('Error al cancelar la solicitud:', e);
        showMessage(`Error al cancelar la solicitud: ${e.message}`, 'error');
        return false;
    }
}

// --- FUNCIÓN ADICIONAL: Cancelar Préstamo por Prestamista (CON PENALIDAD DEL 5% DEL TOTAL) ---
async function cancelLoanByLender(lenderTransactionId, recipientId) {
    if (!currentUser) return;
    const lenderId = currentUser.uid;
    
    const lenderRef = doc(db, `artifacts/${appId}/users/${lenderId}/account/data`); // Referencia a la cuenta del prestamista

    // 1. Encontrar el documento 'loan-sent' del prestamista
    const lenderDocRef = doc(db, `artifacts/${appId}/users/${lenderId}/transactions/${lenderTransactionId}`);
    const lenderDocSnap = await getDoc(lenderDocRef);
    if (!lenderDocSnap.exists() || lenderDocSnap.data().status !== 'completed') {
        throw new Error("Transacción del prestamista no válida o no completada.");
    }
    const loanData = lenderDocSnap.data();
    
    // 2. Buscar el documento 'loan-debt' correspondiente del deudor.
    const debtQuery = query(
        collection(db, `artifacts/${appId}/users/${recipientId}/transactions`),
        where('type', '==', 'loan-debt'),
        where('senderTransactionId', '==', lenderTransactionId),
        where('status', 'in', ['pending', 'pending-offer'])
    );
    const debtSnapshot = await getDocs(debtQuery);
    const debtDoc = debtSnapshot.docs.length > 0 ? debtSnapshot.docs[0] : null;
    const debtDocRef = debtDoc ? doc(db, `artifacts/${appId}/users/${recipientId}/transactions/${debtDoc.id}`) : null;

    // 3. Iniciar Transacción
    try {
        // Cálculo de la penalidad: 5% del TOTAL (Capital + Interés)
        const interestRateDecimal = loanData.interestRate / 100;
        const amountToPay = loanData.originalAmount * (1 + interestRateDecimal);
        const penaltyRate = 0.05; // 5% de penalidad para el prestamista
        const penaltyAmount = amountToPay * penaltyRate; // 5% del total (Capital + Interés)

        await runTransaction(db, async (transaction) => {
            const lenderDoc = await transaction.get(lenderRef);
            if (!lenderDoc.exists()) throw new Error("Documento de la cuenta del prestamista no existe.");
            
            const lenderBalance = lenderDoc.data().balance;

            // DEDUCCIÓN DE LA PENALIDAD DEL PRESTAMISTA
            // IMPORTANTE: NO SE HACE CHEQUEO DE SALDO. SE PERMITE SALDO NEGATIVO.
            const newLenderBalance = lenderBalance - penaltyAmount;

            // 1. DEDUCIR LA PENALIDAD Y ACTUALIZAR SALDO DEL PRESTAMISTA
            transaction.update(lenderRef, { balance: newLenderBalance });
            
            // 2. Marcar el 'loan-sent' del prestamista como pagado/penalizado
            transaction.update(lenderDocRef, { 
                status: 'completed-paid-penalized', // Nuevo estado
                paidAmount: amountToPay, 
                paidDate: serverTimestamp(),
                penaltyAmount: penaltyAmount,
                scoreGiven: false // El prestamista debe puntuar al deudor después de esta acción
            });
            
            // 3. Marcar el 'loan-debt' del deudor como pagado, si existe.
            if (debtDocRef) {
                // El estado 'paid-by-lender' le aparecerá al deudor como "Pagado por Prestamista (Cancelación)"
                transaction.update(debtDocRef, { status: 'paid-by-lender', paidAmount: amountToPay, paidDate: serverTimestamp() });
            }
        });

        // 4. Crear transacciones de historial
        const recipientData = await getAccountData(recipientId);
        const lenderData = await getAccountData(lenderId);

         // A. Registrar la PENALIDAD en el historial del prestamista (Salida de dinero - Negativo)
        await createTransaction(lenderId, {
            amount: penaltyAmount,
            senderId: lenderId,
            recipientId: 'HUG Bank',
            type: 'lender-cancellation-penalty', // Salida de dinero por penalidad (NEGATIVO)
            originalLoanId: lenderTransactionId,
            interestRate: loanData.interestRate,
            senderName: lenderData.name,
            recipientName: 'HUG Bank',
            description: `Penalidad del 5% por cancelación de préstamo a ${recipientData.name}`
        }); 
        
         // B. Registrar el "cobro" del préstamo en el historial del prestamista (Entrada de dinero por la cancelación)
        await createTransaction(lenderId, {
            amount: amountToPay,
            senderId: recipientId, 
            recipientId: lenderId,
            type: 'loan-paid-cancellation', // Entrada de dinero (Cobro de préstamo por cancelación - Solo Historial)
            originalLoanId: lenderTransactionId,
            interestRate: loanData.interestRate,
            senderName: recipientData.name,
            recipientName: lenderData.name,
            description: `Reembolso Bruto por cancelación de préstamo a ${recipientData.name}`
        }); 
         // C. Registrar el pago en el historial del deudor (Solo Historial)
        await createTransaction(recipientId, {
            amount: amountToPay,
            senderId: lenderId,
            recipientId: recipientId,
            type: 'loan-payment-lender-cancellation', 
            originalLoanId: debtDoc ? debtDoc.id : 'N/A',
            interestRate: loanData.interestRate,
            senderName: lenderData.name,
            recipientName: recipientData.name,
            description: `Préstamo cancelado y marcado como pagado por ${lenderData.name}`
        }); 

        showMessage(`Préstamo marcado como PAGADO. Se le ha aplicado una penalidad del 5% ($${penaltyAmount.toFixed(2)}) de la deuda total ($${amountToPay.toFixed(2)}) en su saldo. Ahora puedes puntuar al deudor.`, 'success');
        loadBalance(lenderId);
        listenToTransactions(lenderId); // Forzar recarga de transacciones
    } catch (e) {
        console.error("Fallo al cancelar préstamo:", e);
        showMessage(`Fallo al cancelar el préstamo: ${e.message}`, 'error');
    }
}

// --- FUNCIÓN ADICIONAL: Guardar Puntuación de Crédito ---
async function saveCreditScore(recipientId, score) {
    if (!currentUser) throw new Error("Usuario no autenticado.");
    
    const recipientAccountRef = doc(db, `artifacts/${appId}/users/${recipientId}/account/data`);

    await runTransaction(db, async (transaction) => {
        const recipientDoc = await transaction.get(recipientAccountRef);
        if (!recipientDoc.exists()) throw new Error("Cuenta del deudor no encontrada.");

        const data = recipientDoc.data();
        const currentScore = data.creditScore || { average: 5.0, count: 0 };
        
        // Nuevo cálculo del promedio
        const newTotal = (currentScore.average * currentScore.count) + score;
        const newCount = currentScore.count + 1;
        const newAverage = newTotal / newCount;

        // Actualizar el perfil del deudor
        transaction.update(recipientAccountRef, { 
            creditScore: {
                average: newAverage,
                count: newCount
            }
        });
    });
    // Recargar el score del prestamista, en caso de que sea el mismo, aunque no es su score.
    loadCreditScore(recipientId);
}


// --- MANEJO DE TRANSFERENCIAS Y PRÉSTAMOS ---
document.getElementById('transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { showMessage('Debes iniciar sesión para transferir.', 'error'); return; }

    // El recipientId solo es obligatorio si no es una Solicitud de Préstamo
    const recipientId = transactionTypeSelect.value !== 'loan-request' ? document.getElementById('recipient-id').value.trim() : null;
    const amount = parseFloat(document.getElementById('amount').value);
    const transactionType = transactionTypeSelect.value;
    const interest = parseFloat(document.getElementById('interest').value);
    // NUEVO: Extracción de la descripción
    const description = descriptionInput.value.trim();
    const senderId = currentUser.uid;

    if (transactionType !== 'loan-request' && senderId === recipientId) { 
        showMessage('No puedes transferir a tu propia cuenta.', 'error'); return; 
    }
    if (amount <= 0 || isNaN(amount)) { showMessage('Monto no válido.', 'error'); return; }
    
    // VALIDACIÓN: Interés mínimo requerido según el monto (usa la lógica dinámica)
    const minRequiredInterest = getRequiredMinimumInterest(amount);
    if (transactionType !== 'transfer' && interest < minRequiredInterest) { 
        showMessage(`El interés mínimo para este monto es del ${minRequiredInterest}%.`, 'error'); return; 
    }

    if (transactionType === 'loan-request') {
        const interestRate = interest; // Ya está definido como 'interest'
        
        // MODIFICADO: Interés mínimo 5%, máximo 50%
        if (isNaN(interestRate) || interestRate > 50) { 
            return showMessage('El interés máximo para solicitudes debe ser del 50%.', 'error'); 
        }

        // --- FIX: SOLUCIÓN AL ERROR DEL ÍNDICE (Check de una sola solicitud activa) ---
        // Se busca por un solo campo ('debtorId') para evitar el requisito de índice compuesto.
        const userRequestsQuery = query(
            collection(db, `artifacts/${appId}/loan-requests`),
            where('debtorId', '==', senderId)
        );
        
        let hasActiveRequest = false;
        try {
            const userRequestsSnapshot = await getDocs(userRequestsQuery);
            // Filtramos en el cliente si existe alguna con estado 'pending'
            hasActiveRequest = userRequestsSnapshot.docs.some(doc => doc.data().status === 'pending');
        } catch (e) {
            // Captura errores si el index para 'debtorId' no existe (aunque debería ser un índice simple y seguro)
            console.error("Fallo al verificar solicitud activa:", e.message);
            showMessage(`Error al verificar solicitudes: ${e.message}`, 'error');
            return;
        }
        
        if (hasActiveRequest) {
            showMessage('Ya tienes una solicitud de préstamo activa. Solo puedes tener una a la vez.', 'error'); 
            return; 
        }
        // --- FIN DEL FIX ---

        const senderData = await getAccountData(senderId);
        if (!senderData) { showMessage('No se pudo obtener tu información de cuenta.', 'error'); return; }
        
        const rScore = senderData.creditScore.average.toFixed(1);
        const rCount = senderData.creditScore.count;
        
        const confirmed = await showConfirmModal(
            'Solicitud de Préstamo',
            `Solicitar <strong>$${amount.toFixed(2)}</strong> al <strong>${interestRate}%</strong> de interés.<br><br>Tu Score: <strong>${rScore} ★ (${rCount} votos)</strong>`,
            'info'
        );

        if (!confirmed) {
            showMessage('Solicitud de préstamo cancelada.', 'info'); 
            return; 
        }

        // [Lógica para Solicitud de Préstamo (Debt Offer)]
        try {
            // Colección pública para solicitudes
            const loanRequestsRef = collection(db, `artifacts/${appId}/loan-requests`);
            const requestData = { 
                debtorId: senderId, 
                debtorName: senderData.name, 
                amount: amount, 
                interestRate: interestRate, 
                status: 'pending', // Pendiente de que un prestamista la acepte
                timestamp: serverTimestamp(), 
                creditScoreSnapshot: senderData.creditScore.average,
                description: description // <<-- Descripción guardada
            };

            await addDoc(loanRequestsRef, requestData);
            showMessage('Solicitud de préstamo publicada con éxito. Esperando a un prestamista.', 'success');
            switchView('dashboard');
        } catch (e) {
            console.error("Fallo al publicar solicitud:", e.message);
            showMessage(`Fallo al publicar la solicitud: ${e.message}`, 'error');
        }
        return;
    }

    // Lógica para Transferencia (transfer) y Oferta de Préstamo (loan)
    
    // NUEVO: Obtener el score del receptor para el check de préstamo
    if (transactionType === 'loan') {
        const recipientData = await getAccountData(recipientId);
        if (!recipientData) { showMessage('ID del receptor no encontrado.', 'error'); return; }
        
        const rScore = recipientData.creditScore.average.toFixed(1);
        const rCount = recipientData.creditScore.count;
        
        const confirmed = await showConfirmModal(
            'Enviar Oferta de Préstamo',
            `<strong>${recipientData.name}</strong> (Score: <strong>${rScore} ★</strong>)<br><br>Ofrecer <strong>$${amount.toFixed(2)}</strong> al <strong>${interest}%</strong> de interés`,
            'warning'
        );

        if (!confirmed) {
            showMessage('Oferta de préstamo cancelada por el prestamista.', 'info'); 
            return; 
        }
    }

    const senderRef = doc(db, `artifacts/${appId}/users/${senderId}/account/data`);
    const recipientRef = doc(db, `artifacts/${appId}/users/${recipientId}/account/data`);

    try {
        const senderData = await getAccountData(senderId);
        const recipientData = await getAccountData(recipientId);

        if (!recipientData) { showMessage('ID del receptor no encontrado.', 'error'); return; }

        // Doble check para Transfer y Loan
        if (transactionType === 'loan') {
            // Lógica para Oferta de Préstamo (Aún no se mueve el dinero)
            // Antes de crear la oferta, 'congelamos' el dinero descontándolo del saldo del prestamista.
            try {
                await runTransaction(db, async (transaction) => {
                    const senderDocTx = await transaction.get(senderRef);
                    if (!senderDocTx.exists()) throw new Error("Documento remitente no existe.");
                    const senderBalanceTx = senderDocTx.data().balance;
                    if (senderBalanceTx < amount) throw new Error("Saldo insuficiente para enviar la oferta de préstamo.");
                    transaction.update(senderRef, { balance: senderBalanceTx - amount, held: (senderDocTx.data().held || 0) + amount });
                });
            } catch (err) {
                console.error('Fallo al congelar fondos para la oferta:', err);
                showMessage(`No se pudo congelar fondos: ${err.message}`, 'error');
                return;
            }

            const loanData = {
                amount: amount,
                senderId: senderId,
                recipientId: recipientId,
                interestRate: interest,
                originalAmount: amount,
                status: 'pending-offer',
                recipientName: recipientData ? recipientData.name : 'Desconocido',
                description: description // <<-- Descripción guardada
            };

            // Verificar que el remitente tenga documento de cuenta (la verificación de saldo
            // ya se realizó al intentar congelar los fondos).
            const senderDoc = await getDoc(senderRef);
            if (!senderDoc.exists()) {
                throw new Error("Documento remitente no existe.");
            }

            // 1. Prestamista (Registra la salida potencial de dinero - tipo: loan-sent)
            const loanSentDoc = await createTransaction(senderId, { 
                ...loanData, 
                type: 'loan-sent', 
                scoreGiven: false // Nuevo campo para saber si ya se puntuó
            });

            // 2. Deudor (Registra la OFERTA que debe ACEPTAR/RECHAZAR - tipo: loan-offer)
            await createTransaction(recipientId, { 
                ...loanData, 
                type: 'loan-offer', 
                senderTransactionId: loanSentDoc.id,
                lenderName: senderData ? senderData.name : 'Anónimo'
            });

            showMessage('Oferta de préstamo enviada. El receptor debe aceptarla.', 'success');
            // [ADICIÓN] Guardar contacto automáticamente
            await addContact(senderId, recipientId);

        } else {
            // Lógica para Transferencia Directa (Mover dinero inmediatamente)
            await runTransaction(db, async (transaction) => {
                const senderDoc = await transaction.get(senderRef);
                if (!senderDoc.exists()) throw new Error("Documento remitente no existe.");
                const recipientDoc = await transaction.get(recipientRef);
                if (!recipientDoc.exists()) throw new Error("Documento receptor no existe. Verifica el ID.");

                const senderBalance = senderDoc.data().balance;
                if (senderBalance < amount) throw new Error("Saldo insuficiente.");

                const newSenderBalance = senderBalance - amount;
                const newRecipientBalance = recipientDoc.data().balance + amount;

                transaction.update(senderRef, { balance: newSenderBalance });
                transaction.update(recipientRef, { balance: newRecipientBalance });
            });
            
            const baseTransferData = { 
                amount, 
                senderId, 
                recipientId, 
                senderName: senderData ? senderData.name : 'Anónimo', 
                recipientName: recipientData ? recipientData.name : 'Desconocido',
                description: description // <<-- Descripción guardada
            };

            // Historial del Remitente (Negativo)
            await createTransaction(senderId, { ...baseTransferData, type: 'transfer-sent' });
            // Historial del Receptor (Positivo)
            await createTransaction(recipientId, { ...baseTransferData, type: 'transfer-received' });

            showMessage('Transferencia exitosa.', 'success');
            // [ADICIÓN] Guardar contacto automáticamente
            await addContact(senderId, recipientId);
        }

        switchView('dashboard');
        loadBalance(senderId);

    } catch (e) {
        console.error("Fallo de Transacción: ", e.message);
        showMessage(`Fallo la transferencia: ${e.message}`, 'error');
    }
});

// --- REEMBOLSO DE PRÉSTAMO (Pago) CON COMISIÓN BANCARIA ESCALONADA SOBRE EL TOTAL (CORREGIDO) ---
async function payLoan(loanDocId, loanData) {
    if (!currentUser) return;

    const originalAmount = loanData.originalAmount;
    // Interés en formato decimal (ej: 5% -> 0.05)
    const interestRateDecimal = loanData.interestRate / 100;

    // 1. Cálculo de Montos
    const interestAmount = originalAmount * interestRateDecimal; // Interés bruto
    const amountToPay = originalAmount + interestAmount; // Monto total que paga el deudor (Capital + Interés Bruto)

    // LÓGICA DE COMISIÓN BANCARIA ESCALONADA (Basada en el Monto Original del Préstamo)
    let bankCommissionRate;
    // Comisión: 5% (< $50), 8% ($50 <= x < $250), 10% (>= $250)
    if (originalAmount >= 250) { 
        bankCommissionRate = 0.10; // 10% si >= $250
    } else if (originalAmount >= 50) { 
        bankCommissionRate = 0.08; // 8% si $50 <= Préstamo < $250
    } else {
        bankCommissionRate = 0.05; // 5% si Préstamo < $50
    }
    
    // La comisión se calcula sobre el MONTO TOTAL A PAGAR (Capital + Interés Bruto)
    const bankCommission = amountToPay * bankCommissionRate; // Comisión del banco sobre el TOTAL

    // El prestamista recibe el TOTAL pagado menos la comisión del banco
    const amountLenderReceives = amountToPay - bankCommission;
    
    const payerId = currentUser.uid; // El usuario que paga (el deudor)
    const recipientId = loanData.senderId; // El usuario que recibe (el prestamista original)

    const payerRef = doc(db, `artifacts/${appId}/users/${payerId}/account/data`);
    const recipientRef = doc(db, `artifacts/${appId}/users/${recipientId}/account/data`);
    
    // El documento de deuda que se va a marcar como pagado (es el documento loan-debt del deudor)
    const loanDocRef = doc(db, `artifacts/${appId}/users/${payerId}/transactions/${loanDocId}`);

    // El documento 'loan-sent' del prestamista que se va a marcar como pagado (buscándolo por el senderTransactionId)
    const lenderTransactionId = loanData.senderTransactionId;
    const loanSentDocRef = doc(db, `artifacts/${appId}/users/${recipientId}/transactions/${lenderTransactionId}`);
    
    // El documento de solicitud de préstamo (si existía)
    const loanRequestDocId = loanData.loanRequestDocId; // Asumiendo que este ID existe en loanData

    // 4. Ejecución de la transacción (Mover el dinero y marcar como pagado)
    try {
        await runTransaction(db, async (transaction) => {
            const payerDoc = await transaction.get(payerRef);
            if (!payerDoc.exists()) throw new Error("Documento del pagador (deudor) no existe.");
            const recipientDoc = await transaction.get(recipientRef);
            if (!recipientDoc.exists()) throw new Error("Documento del prestamista no existe. Verifica el ID.");
            
            const payerBalance = payerDoc.data().balance;
            if (payerBalance < amountToPay) throw new Error("Saldo insuficiente para pagar el préstamo.");

            const newPayerBalance = payerBalance - amountToPay; 
            
            // Saldo del prestamista
            const recipientBalance = recipientDoc.data().balance;
            const newRecipientBalance = recipientBalance + amountLenderReceives;

            // 1. ACTUALIZAR SALDO DEL PAGADOR (Deudor)
            transaction.update(payerRef, { balance: newPayerBalance });

            // 2. ACTUALIZAR SALDO DEL RECEPTOR (Prestamista)
            transaction.update(recipientRef, { balance: newRecipientBalance });

            // 3. ACTUALIZAR EL DOCUMENTO DE DEUDA DEL DEUDOR (Marcarlo como pagado)
            transaction.update(loanDocRef, { status: 'completed-paid', paidAmount: amountToPay, paidDate: serverTimestamp() });

            // 4. ACTUALIZAR EL DOCUMENTO DE PRÉSTAMO DEL PRESTAMISTA (Marcarlo como pagado)
            // CÓDIGO CORREGIDO DENTRO DE function payLoan
// 4. ACTUALIZAR EL DOCUMENTO DE PRÉSTAMO DEL PRESTAMISTA (Marcarlo como pagado)
            transaction.update(loanSentDocRef, { status: 'completed-paid', paidAmount: amountToPay, paidDate: serverTimestamp(), scoreGiven: false });
            
            // 5. Cancelar la solicitud de préstamo pública si fue aceptada desde una solicitud
            if (loanRequestDocId) {
                 const loanRequestRef = doc(db, `artifacts/${appId}/loan-requests/${loanRequestDocId}`);
                 transaction.update(loanRequestRef, { status: 'completed-paid', paidDate: serverTimestamp() });
            }
        });

        // 5. Crear transacciones de historial
        const payerData = await getAccountData(payerId);
        const recipientData = await getAccountData(recipientId);

         // A. Registrar la comisión bancaria en el historial del deudor (Salida de dinero - Negativo)
        await createTransaction(payerId, {
            amount: bankCommission,
            senderId: payerId,
            recipientId: 'HUG Bank',
            type: 'bank-commission', // Salida de dinero por comisión (NEGATIVO)
            originalLoanId: loanDocId,
            interestRate: loanData.interestRate,
            senderName: payerData.name,
            recipientName: 'HUG Bank',
            description: loanData.description || 'Comisión por pago de préstamo'
        }); 

         // B. Registrar el pago en el historial del deudor (Solo Historial)
        await createTransaction(payerId, {
            amount: amountToPay,
            senderId: payerId,
            recipientId: recipientId,
            type: 'loan-payment-sent', // Salida de dinero (Pago de préstamo - Solo Historial)
            originalLoanId: loanDocId,
            interestRate: loanData.interestRate,
            senderName: payerData.name,
            recipientName: recipientData.name,
            description: loanData.description || 'Pago de préstamo'
        }); 

         // C. Registrar el pago en el historial del prestamista (Solo Historial)
        await createTransaction(recipientId, {
            amount: amountLenderReceives,
            senderId: payerId,
            recipientId: recipientId,
            type: 'loan-payment-received', // Entrada de dinero (Cobro de préstamo - Solo Historial)
            originalLoanId: lenderTransactionId,
            interestRate: loanData.interestRate,
            senderName: payerData.name,
            recipientName: recipientData.name,
            description: loanData.description || 'Cobro de préstamo'
        }); 

        showMessage(`Préstamo de $${amountToPay.toFixed(2)} pagado con éxito. El banco cobró $${bankCommission.toFixed(2)} de comisión. ¡Ahora puedes puntuar al deudor!`, 'success');
        loadBalance(payerId);
        listenToTransactions(payerId); // Forzar recarga de transacciones
    } catch (e) {
        console.error("Fallo al pagar el préstamo:", e);
        showMessage(`Fallo al pagar el préstamo: ${e.message}`, 'error');
    }
}

// --- FUNCIÓN ADICIONAL: Aceptar una oferta de préstamo (CORREGIDO) ---
async function acceptLoanOffer(debtDocId, debtData) {
     if (!currentUser) return;
     const payerId = debtData.senderId; // El que presta (Prestamista)
     const recipientId = currentUser.uid; // El que acepta (Deudor)
     const amount = debtData.originalAmount;

     const payerRef = doc(db, `artifacts/${appId}/users/${payerId}/account/data`);
     const recipientRef = doc(db, `artifacts/${appId}/users/${recipientId}/account/data`);
     
     // 1. Documento de la OFERTA (loan-offer del deudor)
     const debtDocRef = doc(db, `artifacts/${appId}/users/${recipientId}/transactions/${debtDocId}`);
     // 2. Documento de PRÉSTAMO ENVIADO (loan-sent del prestamista)
     const loanSentDocRef = doc(db, `artifacts/${appId}/users/${payerId}/transactions/${debtData.senderTransactionId}`);
     
     try {
         await runTransaction(db, async (transaction) => {
             // PRIMER PASO: TODAS LAS LECTURAS (ANTES de cualquier escritura)
             const payerDoc = await transaction.get(payerRef);
             if (!payerDoc.exists()) throw new Error("Documento del prestamista no existe.");
             
             const recipientDoc = await transaction.get(recipientRef);
             if (!recipientDoc.exists()) throw new Error("Documento del receptor no existe.");

             // Leer los documentos de deuda/préstamo también
             const debtDocSnapshot = await transaction.get(debtDocRef);
             if (!debtDocSnapshot.exists()) throw new Error("Documento de oferta no existe.");
             
             const loanSentDocSnapshot = await transaction.get(loanSentDocRef);
             if (!loanSentDocSnapshot.exists()) throw new Error("Documento de préstamo no existe.");

             // SEGUNDO PASO: CALCULAR TODO LO QUE NECESITES (sin lecturas/escrituras)
             const payerBalance = payerDoc.data().balance;
             const payerHeld = payerDoc.data().held || 0;
             const newPayerHeld = Math.max(0, payerHeld - amount);
             
             const recipientBalance = recipientDoc.data().balance;
             const newRecipientBalance = recipientBalance + amount;

             // TERCER PASO: TODAS LAS ESCRITURAS (al final)
             transaction.update(payerRef, { held: newPayerHeld });
             transaction.update(recipientRef, { balance: newRecipientBalance });
             
             // Actualizar estado en el Deudor (Pasa de 'loan-offer' a 'loan-debt')
             transaction.update(debtDocRef, { 
                 status: 'pending', // De 'pending-offer' a 'pending' deuda
                 type: 'loan-debt', // Tipo: Deuda (cambio de tipo)
                 receivedDate: serverTimestamp() 
             });

             // Actualizar estado en el Prestamista (Pasa de 'pending-offer' a 'completed')
            transaction.update(loanSentDocRef, { 
                status: 'completed', // De 'pending-offer' a 'completed'
                sentDate: serverTimestamp() 
            });
         });
         
         // 4. Crear transacciones de historial (FUERA de la transacción)
        const payerData = await getAccountData(payerId);
        const recipientData = await getAccountData(recipientId);

         // A. Historial del Prestamista (Salida de dinero - Solo Historial)
        await createTransaction(payerId, {
            amount: amount,
            senderId: payerId,
            recipientId: recipientId,
            type: 'loan-disbursed', // Salida de dinero por desembolso
            originalLoanId: debtData.senderTransactionId,
            interestRate: debtData.interestRate,
            senderName: payerData.name,
            recipientName: recipientData.name,
            description: debtData.description || 'Desembolso de préstamo'
        }); 

         // B. Historial del Deudor (Entrada de dinero - Solo Historial)
        await createTransaction(recipientId, {
            amount: amount,
            senderId: payerId,
            recipientId: recipientId,
            type: 'loan-received', // Entrada de dinero por préstamo
            originalLoanId: debtDocId,
            interestRate: debtData.interestRate,
            senderName: payerData.name,
            recipientName: recipientData.name,
            description: debtData.description || 'Recepción de préstamo'
        }); 

         showMessage('Préstamo aceptado y dinero recibido. ¡Ahora tienes una deuda!', 'success');
         loadBalance(recipientId); // Recargar saldo del deudor
         listenToTransactions(recipientId); // Forzar recarga de transacciones
         
     } catch (e) {
         console.error("Fallo al aceptar el préstamo:", e);
         showMessage(`Fallo al aceptar el préstamo: ${e.message}`, 'error');
     }
}

// --- FUNCIÓN ADICIONAL: Prestar en respuesta a una solicitud pública (CORREGIDO) ---
async function lendOnRequest(requestDocId, requestData) {
     if (!currentUser) return;
     const lenderId = currentUser.uid; // El que presta (Prestamista)
     const debtorId = requestData.debtorId; // El que solicitó (Deudor)
     const amount = requestData.amount;
     const interest = requestData.interestRate;
     
     const lenderRef = doc(db, `artifacts/${appId}/users/${lenderId}/account/data`);
     const debtorRef = doc(db, `artifacts/${appId}/users/${debtorId}/account/data`);
     const requestDocRef = doc(db, `artifacts/${appId}/loan-requests/${requestDocId}`);
     
     // Declarar fuera del try para acceso en el catch
     let newLoanDoc = null;
     let newDebtDoc = null;
     
     try {
         // 1. Obtener información del prestamista ANTES de la transacción
         const lenderDocData = await getDoc(lenderRef);
         if (!lenderDocData.exists()) throw new Error("Documento del prestamista no existe.");
         const lenderName = lenderDocData.data().name;

         // 2. Crear los documentos de transacción FUERA de la transacción (antes)
         const loanSentRef = collection(db, `artifacts/${appId}/users/${lenderId}/transactions`);
         newLoanDoc = await addDoc(loanSentRef, {
            amount: amount,
            senderId: lenderId,
            recipientId: debtorId,
            interestRate: interest,
            originalAmount: amount,
            status: 'completed', // Se marca como completado inmediatamente
            type: 'loan-sent',
            sentDate: serverTimestamp(),
            scoreGiven: false,
            recipientName: requestData.debtorName,
            description: requestData.description || 'Préstamo por solicitud pública'
         });

         // Crear el documento de deuda en el deudor
         const debtRef = collection(db, `artifacts/${appId}/users/${debtorId}/transactions`);
         newDebtDoc = await addDoc(debtRef, {
            amount: amount,
            senderId: lenderId,
            recipientId: debtorId,
            interestRate: interest,
            originalAmount: amount,
            status: 'pending', // Pendiente de pago
            type: 'loan-debt',
            receivedDate: serverTimestamp(),
            senderTransactionId: newLoanDoc.id, // Referencia cruzada
            lenderName: lenderName,
            loanRequestDocId: requestDocId, // Referencia a la solicitud pública
            description: requestData.description || 'Deuda por solicitud pública'
         });

         // 3. Ahora ejecutar la transacción SOLO para actualizar saldos y estados
         await runTransaction(db, async (transaction) => {
             // PRIMER PASO: TODAS LAS LECTURAS
             const lenderDoc = await transaction.get(lenderRef);
             if (!lenderDoc.exists()) throw new Error("Documento del prestamista no existe.");

             const requestDoc = await transaction.get(requestDocRef);
             if (!requestDoc.exists() || requestDoc.data().status !== 'pending') {
                 throw new Error("La solicitud ya no está disponible o ha sido completada.");
             }

             const debtorDoc = await transaction.get(debtorRef);
             if (!debtorDoc.exists()) throw new Error("Documento del deudor no existe.");

             // SEGUNDO PASO: CALCULAR TODO
             const lenderBalance = lenderDoc.data().balance;
             if (lenderBalance < amount) throw new Error("Saldo insuficiente para conceder el préstamo.");
             
             const newLenderBalance = lenderBalance - amount;
             const newDebtorBalance = debtorDoc.data().balance + amount;
             
             // TERCER PASO: TODAS LAS ESCRITURAS
             transaction.update(lenderRef, { balance: newLenderBalance });
             transaction.update(debtorRef, { balance: newDebtorBalance });
             
             // Marcar la solicitud pública como ACEPTADA/COMPLETADA
             transaction.update(requestDocRef, { 
                 status: 'accepted',
                 lenderId: lenderId,
                 lenderName: lenderName,
                 loanSentDocId: newLoanDoc.id,
                 loanDebtDocId: newDebtDoc.id,
                 acceptedDate: serverTimestamp()
             });
         });
         
         // 4. Crear transacciones de historial (fuera de la transacción)
        const lenderData = await getAccountData(lenderId);
        const debtorData = await getAccountData(debtorId);

         // A. Historial del Prestamista (Salida de dinero - Solo Historial)
        await createTransaction(lenderId, {
            amount: amount,
            senderId: lenderId,
            recipientId: debtorId,
            type: 'loan-disbursed', // Salida de dinero por desembolso
            originalLoanId: newLoanDoc.id,
            interestRate: interest,
            senderName: lenderData.name,
            recipientName: debtorData.name,
            description: requestData.description || 'Desembolso de préstamo (solicitud)'
        }); 

         // B. Historial del Deudor (Entrada de dinero - Solo Historial)
        await createTransaction(debtorId, {
            amount: amount,
            senderId: lenderId,
            recipientId: debtorId,
            type: 'loan-received', // Entrada de dinero por préstamo
            originalLoanId: newDebtDoc.id,
            interestRate: interest,
            senderName: lenderData.name,
            recipientName: debtorData.name,
            description: requestData.description || 'Recepción de préstamo (solicitud)'
        }); 

         showMessage(`Préstamo de $${amount.toFixed(2)} concedido con éxito. El dinero ha sido transferido al deudor.`, 'success');
         loadBalance(lenderId);
         listenToTransactions(lenderId);
         
     } catch (e) {
         console.error("Fallo al conceder el préstamo:", e);
         showMessage(`Fallo al conceder el préstamo: ${e.message}`, 'error');
         
         // Si la transacción falló, intentar eliminar los documentos de transacción creados
         try {
             if (newLoanDoc && newLoanDoc.id) {
                 await deleteDoc(doc(db, `artifacts/${appId}/users/${lenderId}/transactions/${newLoanDoc.id}`));
             }
             if (newDebtDoc && newDebtDoc.id) {
                 await deleteDoc(doc(db, `artifacts/${appId}/users/${debtorId}/transactions/${newDebtDoc.id}`));
             }
         } catch (delErr) {
             console.warn("No se pudieron limpiar documentos después del fallo:", delErr);
         }
     }
}

// --- MANEJO DE OFERTAS/DEUDAS PENDIENTES ---
function listenToTransactions(userId) {
    if (!userId) return;

    const transactionsRef = collection(db, `artifacts/${appId}/users/${userId}/transactions`);
    
    // Consulta para Historial Completo (ordenado por fecha)
    const historyQuery = query(transactionsRef, orderBy('timestamp', 'desc'));

    // Consulta para Deudas/Ofertas (solo 'loan-offer' o 'loan-debt' con status 'pending-offer' o 'pending')
    // FIX #1: Se elimina 'orderBy' para evitar el error de índice compuesto de Firestore con la cláusula 'in'.
    const pendingQuery = query(transactionsRef, 
        where('status', 'in', ['pending-offer', 'pending', 'completed', 'completed-paid-penalized', 'completed-paid']) // Se añade 'completed-paid-penalized' para el nuevo botón de puntuar
    );

    // Listener para el Historial Completo
    onSnapshot(historyQuery, (snapshot) => {
        let html = '';
        if (snapshot.empty) {
            transactionsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No hay transacciones en el historial.</p>';
            return;
        }
        
        snapshot.forEach(doc => {
            html += renderTransactionItem(doc.data(), doc.id, false);
        });
        transactionsList.innerHTML = html;
    }, (error) => {
         console.error("Error al escuchar historial de transacciones:", error);
         transactionsList.innerHTML = '<p class="text-red-500 text-sm text-center">Error al cargar el historial.</p>';
    });


    // Listener para Deudas y Ofertas (lista lateral)
    onSnapshot(pendingQuery, (snapshot) => {
        let debtHtml = '';
        if (snapshot.empty) {
             debtsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No hay deudas u ofertas pendientes.</p>';
             // No es necesario retornar, solo actualizar la UI
        }

        snapshot.forEach(doc => {
            const transaction = doc.data();
            const isPendingOffer = transaction.status === 'pending-offer';
            const isPendingDebt = transaction.status === 'pending' && transaction.type === 'loan-debt';
            
            // Prestamos concedidos (completed), cancelados (completed-paid-penalized) o pagados (completed-paid), que NO han sido puntuados.
            const isScorePending = (transaction.status === 'completed' || transaction.status === 'completed-paid-penalized' || transaction.status === 'completed-paid') 
                                   && transaction.type === 'loan-sent' 
                                   && transaction.scoreGiven !== true; 
            
            if (isPendingOffer || isPendingDebt || isScorePending) {
               debtHtml += renderTransactionItem(transaction, doc.id, true);
            }
        });

        if (debtHtml === '') {
             debtsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No hay deudas u ofertas pendientes.</p>';
        } else {
            debtsList.innerHTML = debtHtml;
        }
        
        // --- LISTENERS DINÁMICOS ---
        
        // 1. Aceptar Oferta
        debtsList.querySelectorAll('.accept-loan-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const docId = button.dataset.id;
                const docSnap = await getDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions/${docId}`));
                if (docSnap.exists()) {
                    await acceptLoanOffer(docId, docSnap.data());
                }
            });
        });

        // 1.b Rechazar Oferta (Rechazo por parte del receptor)
        debtsList.querySelectorAll('.reject-offer-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const docId = button.dataset.id;
                const senderTransactionId = button.dataset.sendertransactionid;
                const senderId = button.dataset.senderid;
                if (!docId) return;
                
                const confirmed = await showConfirmModal(
                    'Rechazar Oferta',
                    '¿Rechazas esta oferta de préstamo? Los fondos serán devueltos al prestamista.',
                    'warning'
                );
                if (!confirmed) return;

                try {
                    // Realizamos una transacción para:
                    // 1) Marcar la oferta del receptor como 'rejected'
                    // 2) Si existe, actualizar el documento del prestamista a 'rejected-by-recipient'
                    // 3) Liberar los fondos retenidos (held) del prestamista y devolver el monto al balance
                    const recipientOfferRef = doc(db, `artifacts/${appId}/users/${userId}/transactions/${docId}`);

                    await runTransaction(db, async (transaction) => {
                        // Read all documents first (Firestore requires reads before writes)
                        const offerSnap = await transaction.get(recipientOfferRef);
                        if (!offerSnap.exists()) throw new Error('Oferta no encontrada.');
                        const offerData = offerSnap.data();
                        const amount = parseFloat(offerData.amount || offerData.originalAmount || 0);

                        // Prepare lender refs and read them (if provided)
                        let lenderAccountRef = null;
                        let lenderTxRef = null;
                        let lenderAccountSnap = null;
                        let lenderTxSnap = null;

                        if (senderId && senderTransactionId) {
                            lenderAccountRef = doc(db, `artifacts/${appId}/users/${senderId}/account/data`);
                            lenderTxRef = doc(db, `artifacts/${appId}/users/${senderId}/transactions/${senderTransactionId}`);

                            lenderAccountSnap = await transaction.get(lenderAccountRef);
                            try {
                                lenderTxSnap = await transaction.get(lenderTxRef);
                            } catch (e) {
                                // If the lender transaction doc can't be read, continue — we may still refund
                                lenderTxSnap = null;
                            }
                        }

                        // Now perform writes
                        transaction.update(recipientOfferRef, { status: 'rejected', rejectedDate: serverTimestamp() });

                        if (lenderAccountSnap && lenderAccountSnap.exists()) {
                            const currentBalance = lenderAccountSnap.data().balance || 0;
                            const currentHeld = lenderAccountSnap.data().held || 0;
                            const refund = amount; // Full refund to lender when recipient rejects
                            const newHeld = Math.max(0, currentHeld - refund);
                            const newBalance = currentBalance + refund;

                            transaction.update(lenderAccountRef, { balance: newBalance, held: newHeld });
                        }

                        if (lenderTxSnap && lenderTxSnap.exists()) {
                            transaction.update(lenderTxRef, { status: 'rejected-by-recipient', rejectedDate: serverTimestamp() });
                        }
                    });

                    // Registrar en historial y recargar saldo (operación fuera de la transacción para evitar problemas de concurrencia)
                    if (senderId) {
                        try {
                            const lenderData = await getAccountData(senderId);
                            const recipientData = await getAccountData(userId);
                            const offerSnapPost = await getDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions/${docId}`));
                            const amount = parseFloat((offerSnapPost.exists() ? (offerSnapPost.data().amount || offerSnapPost.data().originalAmount) : 0) || 0);
                            if (amount > 0) {
                                // Historial: reembolso por rechazo
                                await createTransaction(senderId, {
                                    amount: amount,
                                    senderId: 'HUG Bank',
                                    recipientId: senderId,
                                    type: 'offer-rejected-refund',
                                    senderName: 'HUG Bank',
                                    recipientName: lenderData ? lenderData.name : 'Prestamista',
                                    description: `Reembolso por rechazo de oferta a ${recipientData ? recipientData.name : 'Receptor'}`
                                });
                            }
                        } catch (histErr) {
                            console.warn('No se pudo crear entrada de historial del reembolso:', histErr.message);
                        }
                    }

                    showMessage('Oferta rechazada correctamente. Fondos devueltos al prestamista.', 'info');
                    // Forzar recarga del saldo y transacciones para reflejar los cambios
                    if (currentUser) {
                        loadBalance(currentUser.uid);
                        listenToTransactions(currentUser.uid);
                    }
                } catch (err) {
                    console.error('Error al rechazar la oferta y liberar fondos:', err);
                    showMessage(`Error al rechazar la oferta: ${err.message}`, 'error');
                }
            });
        });
        
        // 2. Pagar Deuda
        debtsList.querySelectorAll('.pay-debt-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const docId = button.dataset.id;
                const docSnap = await getDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions/${docId}`));
                if (docSnap.exists()) {
                    // Se muestra diálogo de confirmación en payLoan
                    await payLoan(docId, docSnap.data());
                }
            });
        });

        // 3. Marcar como pagado (Cancelar con Penalidad)
        debtsList.querySelectorAll('.cancel-loan-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const docId = button.dataset.id; // Doc ID del prestamista (loan-sent)
                const recipientId = button.dataset.recipient; // ID del deudor
                
                const confirmed = await showConfirmModal(
                    'Marcar Préstamo como Pagado',
                    '⚠️ <strong>ADVERTENCIA:</strong> Se te aplicará una <strong>penalidad del 5%</strong> sobre la deuda total. Esto afectará tu balance inmediatamente y podrás puntuar al deudor.',
                    'danger'
                );
                if (confirmed) {
                    await cancelLoanByLender(docId, recipientId);
                } else {
                    showMessage('Operación abortada.', 'info');
                }
            });
        });

        // 3.b Cancelar Oferta Pendiente (Prestamista) -> devuelve 95% y cobra 5%
        debtsList.querySelectorAll('.cancel-offer-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const docId = button.dataset.id; // loan-sent doc id
                const amount = parseFloat(button.dataset.amount) || 0;
                const recipientId = button.dataset.recipient || null;
                if (!docId) return;
                
                const penalty = (amount * 0.05).toFixed(2);
                const confirmed = await showConfirmModal(
                    'Cancelar Oferta de Préstamo',
                    `Esto devolverá el <strong>95%</strong> del monto y cobrará una penalidad de <strong>5%</strong>.<br><br>Monto: $${amount.toFixed(2)} | Penalidad: $${penalty}`,
                    'danger'
                );
                if (!confirmed) return;

                try {
                    const lenderId = currentUser.uid;
                    const lenderRef = doc(db, `artifacts/${appId}/users/${lenderId}/account/data`);
                    const loanSentRef = doc(db, `artifacts/${appId}/users/${lenderId}/transactions/${docId}`);

                    const penalty = amount * 0.05;
                    const refund = amount - penalty;

                    // 1) Ejecutar transacción para devolver el dinero (neto) al saldo del prestamista y marcar la oferta cancelada
                    await runTransaction(db, async (transaction) => {
                        const lenderDoc = await transaction.get(lenderRef);
                        if (!lenderDoc.exists()) throw new Error('Cuenta del prestamista no encontrada.');
                        const currentBalance = lenderDoc.data().balance || 0;
                        const currentHeld = lenderDoc.data().held || 0;
                        const newBalance = currentBalance + refund;
                        const newHeld = Math.max(0, currentHeld - amount);
                        transaction.update(lenderRef, { balance: newBalance, held: newHeld });
                        // Marcar la oferta como cancelada
                        transaction.update(loanSentRef, { status: 'cancelled-by-lender', cancelledDate: serverTimestamp(), cancellationFee: penalty });
                    });

                    // 2) Intentar marcar la oferta correspondiente en el receptor (si existe)
                    if (recipientId) {
                        try {
                            const recipientQuery = query(
                                collection(db, `artifacts/${appId}/users/${recipientId}/transactions`),
                                where('senderTransactionId', '==', docId)
                            );
                            const snap = await getDocs(recipientQuery);
                            if (!snap.empty) {
                                for (const d of snap.docs) {
                                    await updateDoc(doc(db, `artifacts/${appId}/users/${recipientId}/transactions/${d.id}`), { status: 'offer-cancelled', cancelledDate: serverTimestamp() });
                                }
                            }
                        } catch (innerErr) {
                            console.warn('No se pudo actualizar la oferta en el receptor:', innerErr.message);
                        }
                    }

                    // 3) Registrar transacción de penalidad y reembolso en historial
                    const lenderData = await getAccountData(lenderId);
                    await createTransaction(lenderId, {
                        amount: penalty,
                        senderId: lenderId,
                        recipientId: 'HUG Bank',
                        type: 'offer-cancel-fee',
                        senderName: lenderData.name,
                        recipientName: 'HUG Bank',
                        description: `Penalidad 5% por cancelar oferta de préstamo` 
                    });

                    await createTransaction(lenderId, {
                        amount: refund,
                        senderId: 'HUG Bank',
                        recipientId: lenderId,
                        type: 'offer-cancel-refund',
                        senderName: 'HUG Bank',
                        recipientName: lenderData.name,
                        description: `Reembolso neto por cancelación de oferta` 
                    });

                    showMessage('Oferta cancelada. Se aplicó una penalidad del 5% y el resto fue devuelto.', 'success');
                    loadBalance(lenderId);
                    listenToTransactions(lenderId);
                } catch (err) {
                    console.error('Error al cancelar oferta:', err);
                    showMessage(`Error al cancelar la oferta: ${err.message}`, 'error');
                }
            });
        });

         // 4. Puntuar Deudor (Prestamista)
        debtsList.querySelectorAll('.score-debtor-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const loanDocId = button.dataset.id;
                const recipientId = button.dataset.recipient;
                const recipientName = button.dataset.recipientname;
                
                scoreModal.style.display = 'block';
                scoreModalRecipientName.textContent = recipientName;
                scoreModalRecipientId.textContent = recipientId;
                scoreForm.setAttribute('data-loan-doc-id', loanDocId);
                scoreForm.setAttribute('data-recipient-id', recipientId);
                // Resetear el formulario al abrir
                scoreForm.reset();
            });
        });
        // --- FIN LISTENERS DINÁMICOS ---

    }, (error) => {
         // Esta es la parte que captura el error. Dejamos el console.error para debug.
         console.error("Error al escuchar deudas/ofertas:", error);
         debtsList.innerHTML = '<p class="text-red-500 text-sm text-center">Error al cargar deudas y ofertas. Intenta recargar la página.</p>';
    });
}


// --- FUNCIÓN PRINCIPAL PARA RENDERIZAR ELEMENTOS DEL HISTORIAL (CORREGIDA PARA SOPORTAR NUEVOS TIPOS Y DESCRIPCIÓN) ---
function renderTransactionItem(transaction, docId, isDebtList = true) {
    const amount = transaction.amount || 0;
    const type = transaction.type;
    const senderName = transaction.senderName || 'Anónimo';
    const recipientName = transaction.recipientName || 'Anónimo';
    const interestRate = transaction.interestRate || 0;
    const status = transaction.status || 'N/A';
    const senderIsMe = transaction.senderId === currentUser.uid;
    
    let typeText = 'Transacción';
    let senderRecipientText = '';
    let textColor = 'text-gray-800';
    let borderColor = 'border-gray-200';
    let amountDisplay = `<p class="text-md font-bold text-gray-800">$${amount.toFixed(2)}</p>`;
    let buttonHtml = '';
    let details = '';

    // Convertir el timestamp de Firebase a un string legible
    const date = transaction.timestamp instanceof Object && 'toDate' in transaction.timestamp 
        ? transaction.timestamp.toDate() 
        : (transaction.timestamp ? new Date(transaction.timestamp) : new Date()); // FIX ROBUSTO: Handle potential missing/invalid timestamp
        
    const timestamp = date.toLocaleDateString('es-ES', { 
        year: 'numeric', month: 'short', day: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
    });

    // Lógica por tipo de transacción
    switch (type) {
        case 'transfer-sent':
            typeText = 'Transferencia Enviada';
            senderRecipientText = `a ${recipientName}`;
            textColor = 'text-red-600';
            borderColor = 'border-red-400';
            amountDisplay = `<p class="text-md font-bold text-red-600">-$${amount.toFixed(2)}</p>`;
            break;
        case 'transfer-received':
            typeText = 'Transferencia Recibida';
            senderRecipientText = `de ${senderName}`;
            textColor = 'text-green-600';
            borderColor = 'border-green-400';
            amountDisplay = `<p class="text-md font-bold text-green-600">+$${amount.toFixed(2)}</p>`;
            break;
        case 'loan-offer':
            typeText = 'Oferta de Préstamo Recibida';
            senderRecipientText = `de ${senderName}`;
            textColor = 'text-blue-600';
            borderColor = 'border-blue-400';
            
            if (status === 'pending-offer' && isDebtList) {
                 const amountToPay = amount * (1 + (interestRate / 100));
                 details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                 amountDisplay = `
                    <p class="text-md font-bold text-gray-800">+$${amount.toFixed(2)}</p>
                    <p class="text-xs text-red-600">Pagar: $${amountToPay.toFixed(2)}</p>`;
                                    buttonHtml = `
                                        <div class="flex gap-2 justify-end mt-1">
                                             <button class="accept-loan-btn py-1 px-3 rounded-full text-xs font-semibold text-white btn-primary" data-id="${docId}">Aceptar</button>
                                             <button class="reject-offer-btn py-1 px-3 rounded-full text-xs font-semibold text-gray-800 btn-secondary" data-id="${docId}" data-sendertransactionid="${transaction.senderTransactionId || ''}" data-senderid="${transaction.senderId || ''}">Rechazar</button>
                                        </div>
                                    `;
            }
            break;
        case 'loan-sent':
            typeText = 'Préstamo Enviado (Oferta)';
            senderRecipientText = `a ${recipientName}`;
            textColor = 'text-blue-600';
            borderColor = 'border-blue-400';
            
            if (status === 'pending-offer') {
                 details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                 amountDisplay = `<p class="text-md font-bold text-gray-800">-$${amount.toFixed(2)} (Oferta)</p>`;
                 if (isDebtList && senderIsMe) {
                     // Mostrar botón pequeño para cancelar la oferta (cobra 5%)
                     buttonHtml = `
                        <div class="flex gap-2 justify-end mt-1">
                            <button class="cancel-offer-btn py-1 px-3 rounded-full text-xs font-semibold text-gray-800 btn-secondary" data-id="${docId}" data-amount="${amount}" data-recipient="${transaction.recipientId || ''}">Cancelar Oferta</button>
                        </div>
                     `;
                 }
            } else if (status === 'completed') {
                typeText = 'Préstamo Concedido';
                const amountToPay = amount * (1 + (interestRate / 100));
                details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                amountDisplay = `
                    <p class="text-md font-bold text-red-600">-$${amount.toFixed(2)} (Capital)</p>
                    <p class="text-xs text-green-600">Cobrar: $${amountToPay.toFixed(2)}</p>
                    <p class="text-xs text-gray-500">Estado: Pendiente de Pago</p>
                `;
                // CAMBIO SOLICITADO: Solo mostrar botón de Cancelación/Marcar como pagado
                if (isDebtList) {
                    buttonHtml = `
                        <button class="cancel-loan-btn w-full py-1 px-3 rounded-full text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition mt-1" 
                            data-id="${docId}" data-recipient="${transaction.recipientId}">Marcar como Pagado (5% P.)</button>
                    `;
                }
} else if (status === 'completed-paid') { // <--- ESTE ES EL ESTADO QUE ACTIVA EL BOTÓN
            typeText = 'Préstamo Cobrado';
            textColor = 'text-green-700';
            borderColor = 'border-green-500';
            // El cálculo neto de lo recibido no es trivial en el cliente, se muestra el monto bruto por defecto
            amountDisplay = `<p class="text-md font-bold text-green-700">+$${(transaction.paidAmount || 0).toFixed(2)}</p>`;
            details = `<p class="text-xs text-gray-600">Pagado el: ${new Date(transaction.paidDate.toDate()).toLocaleDateString('es-ES')}</p>`;
        
        // Si está Pagado y Penalizado (Tú lo marcaste como pagado)
        } else if (status === 'completed-paid-penalized') {
            typeText = 'Préstamo Cancelado (Penalizado)';
            textColor = 'text-yellow-700';
            borderColor = 'border-yellow-500';
             const amountReceived = transaction.paidAmount - transaction.penaltyAmount;
             amountDisplay = `<p class="text-md font-bold text-yellow-700">+$${amountReceived.toFixed(2)} (Neto)</p>`;
             details = `<p class="text-xs text-gray-600">Penalidad: $${transaction.penaltyAmount.toFixed(2)}</p>`;
        }
        
                // (cancelLoanRequest moved to top-level)

        // Botón de Puntuar: Aparece si está pagado o penalizado, y no ha sido puntuado
        // *** ESTA ES LA LÍNEA QUE DEBE SER CORRECTA ***
        if (isDebtList && (status === 'completed-paid' || status === 'completed-paid-penalized') && transaction.scoreGiven !== true) {
             buttonHtml += `
                 <button class="score-debtor-btn w-full py-1 px-3 rounded-full text-xs font-semibold text-white bg-green-500 hover:bg-green-600 transition mt-1" 
                     data-id="${docId}" data-recipient="${transaction.recipientId}" data-recipientname="${recipientName}">Puntuar</button>
             `;
        }
                
                break;
            case 'loan-debt':
                typeText = 'Deuda Pendiente';
                senderRecipientText = `con ${senderName}`;
                textColor = 'text-red-700';
                borderColor = 'border-red-500';
                const amountToPay = transaction.originalAmount * (1 + (interestRate / 100));
                details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                
                if (status === 'pending') {
                     amountDisplay = `
                        <p class="text-md font-bold text-green-600">+$${transaction.originalAmount.toFixed(2)} (Capital)</p>
                        <p class="text-xs text-red-600">Pagar: $${amountToPay.toFixed(2)}</p>
                    `;
                    if (isDebtList) {
                        buttonHtml = `<button class="pay-debt-btn w-full py-1 px-3 rounded-full text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition mt-1" data-id="${docId}">Pagar $${amountToPay.toFixed(2)}</button>`;
                    }
                } else if (status === 'completed-paid') {
                    typeText = 'Deuda Pagada';
                    textColor = 'text-green-700';
                    borderColor = 'border-green-500';
                    amountDisplay = `<p class="text-md font-bold text-red-700">-$${amountToPay.toFixed(2)}</p>`;
                    details = `<p class="text-xs text-gray-600">Pagado el: ${new Date(transaction.paidDate.toDate()).toLocaleDateString('es-ES')}</p>`;
                } else if (status === 'paid-by-lender') {
                    // El deudor ve su deuda marcada como pagada por el prestamista (Cancelación)
                    typeText = 'Deuda Pagada (Cancelación)';
                    textColor = 'text-green-700';
                    borderColor = 'border-green-500';
                    amountDisplay = `<p class="text-md font-bold text-red-700">-$${amountToPay.toFixed(2)}</p>`;
                    details = `<p class="text-xs text-gray-600 font-semibold">Marcada como Pagada por ${senderName}</p>`;
                }
                break;
            // --- NUEVOS TIPOS DE HISTORIAL (Solo historial, no aparecen en 'Deudas y Ofertas') ---
            case 'loan-disbursed': // Prestamista cuando el deudor acepta una oferta o solicitud
                typeText = 'Desembolso Préstamo';
                senderRecipientText = `a ${recipientName}`;
                textColor = 'text-red-600';
                amountDisplay = `<p class="text-md font-bold text-red-600">-$${amount.toFixed(2)}</p>`;
                details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                break;
            case 'loan-received': // Deudor cuando recibe el préstamo
                typeText = 'Préstamo Recibido';
                senderRecipientText = `de ${senderName}`;
                textColor = 'text-green-600';
                amountDisplay = `<p class="text-md font-bold text-green-600">+$${amount.toFixed(2)}</p>`;
                details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                break;
            case 'loan-payment-sent': // Pago total de la deuda por el deudor (historial)
                 typeText = 'Pago de Deuda Total';
                 senderRecipientText = `a ${recipientName}`;
                 textColor = 'text-red-800';
                 amountDisplay = `<p class="text-md font-bold text-red-800">-$${amount.toFixed(2)}</p>`;
                 details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                 break;
            case 'loan-payment-received': // Cobro total de la deuda por el prestamista (historial)
                 typeText = 'Cobro de Préstamo (Neto)';
                 senderRecipientText = `de ${senderName}`;
                 textColor = 'text-green-800';
                 amountDisplay = `<p class="text-md font-bold text-green-800">+$${amount.toFixed(2)}</p>`;
                 details = `<p class="text-xs text-gray-600">Interés: ${interestRate}%</p>`;
                 break;
             case 'bank-commission':
                typeText = 'Comisión Bancaria';
                senderRecipientText = 'HUG Bank';
                textColor = 'text-orange-600';
                borderColor = 'border-orange-400';
                amountDisplay = `<p class="text-md font-bold text-red-600">-$${amount.toFixed(2)}</p>`;
                break;
             case 'score-reset-fee':
                typeText = 'Comisión Reset Score';
                senderRecipientText = 'HUG Bank';
                textColor = 'text-orange-600';
                borderColor = 'border-orange-400';
                amountDisplay = `<p class="text-md font-bold text-red-600">-$${amount.toFixed(2)}</p>`;
                break;
             case 'loan-paid-cancellation':
                typeText = 'Cobro por Cancelación';
                senderRecipientText = `de ${senderName}`;
                textColor = 'text-yellow-600';
                borderColor = 'border-yellow-400';
                amountDisplay = `<p class="text-md font-bold text-yellow-600">+$${amount.toFixed(2)} (Bruto)</p>`;
                break;
             case 'lender-cancellation-penalty':
                typeText = 'Penalidad por Cancelación';
                senderRecipientText = 'HUG Bank';
                textColor = 'text-red-800';
                borderColor = 'border-red-500';
                amountDisplay = `<p class="text-md font-bold text-red-800">-$${amount.toFixed(2)}</p>`;
                break;
            default:
                // FIX #3: Transacciones desconocidas con signo + o -
                typeText = ``;
                textColor = 'text-gray-500';
                borderColor = 'border-blue-500';
                
                if (senderIsMe) {
                    amountDisplay = `<p class="text-md font-bold text-red-600">-$${amount.toFixed(2)}</p>`;
                } else {
                    amountDisplay = `<p class="text-md font-bold text-gray-500">$${amount.toFixed(2)}</p>`;
                }
                break;
    }

    // FIX #2 y SOLICITUD ADICIONAL: Usar la descripción como título principal y limpiar "Transacción Desconocida"
    let mainTitle = transaction.description && transaction.description.length > 0
        ? transaction.description
        : `${typeText} ${senderRecipientText}`;

    // La información secundaria ahora incluye el tipo si se usó la descripción como título.
    // Si es Transacción Desconocida, y hay descripción, no mostramos el texto secundario para limpiar.
    let secondaryTypeHtml = '';
    if (transaction.description && transaction.description.length > 0) {
         if (type === 'unknown' || type === 'default') {
            // Si es desconocida Y tiene descripción, NO mostramos info secundaria para limpiar.
            secondaryTypeHtml = '';
         } else {
            // Si tiene descripción y es un tipo conocido, mostramos el tipo como secundario.
            secondaryTypeHtml = `<p class="text-xs text-gray-600">${typeText} ${senderRecipientText}</p>`;
         }
    }


    return `
        <div class="transaction-item flex items-center justify-between p-3 rounded-lg border-l-4 ${borderColor} bg-white hover:bg-gray-50 transition duration-150">
            <div class="flex-grow">
                <p class="text-sm font-semibold ${textColor}">${mainTitle}</p>
                ${secondaryTypeHtml} 
                <p class="text-xs text-gray-500 mt-0.5">${timestamp}</p>
                ${details}
            </div>
            <div class="flex-shrink-0 space-y-1 text-right">
                ${amountDisplay}
                ${buttonHtml}
            </div>
        </div>
    `;
}

// [ADICIÓN: Función para escuchar Solicitudes de Préstamo]
function listenToLoanRequests(userId) {
if (!userId) return;

// 1. Consulta SIMPLE en Firestore
// Solo filtra por el estado 'pending', lo cual es un filtro simple que no requiere índice compuesto.
const q = query(
    collection(db, `artifacts/${appId}/loan-requests`),
    where('status', '==', 'pending') 
    // Opcional: puedes añadir un orderBy() simple aquí, si es necesario, 
    // por ejemplo: orderBy('timestamp', 'desc')
);

onSnapshot(q, (querySnapshot) => {
    loanRequestsList.innerHTML = '';
    
    const currentUserId = userId; 
    
    // 2. Incluimos todas las solicitudes en la UI y diferenciamos las propias
    const docs = querySnapshot.docs;

    if (docs.length === 0) {
        loanRequestsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No hay solicitudes de préstamo activas en este momento.</p>';
        return;
    }

    // 3. Separar en solicitudes públicas (no creadas por el usuario) y 'Mis solicitudes'
    // Filtramos también las solicitudes que el usuario ya RECHAZÓ (campo rejectedBy: [uid,...])
    const publicRequests = docs.filter(d => {
        const data = d.data();
        const rejectedByMe = Array.isArray(data.rejectedBy) && data.rejectedBy.includes(currentUserId);
        return data.debtorId !== currentUserId && !rejectedByMe;
    });
    const myRequests = docs.filter(d => d.data().debtorId === currentUserId);

    // Si no hay públicas ni propias, mostrar mensaje
    if (publicRequests.length === 0 && myRequests.length === 0) {
        loanRequestsList.innerHTML = '<p class="text-gray-500 text-sm text-center">No hay solicitudes de préstamo activas en este momento.</p>';
        return;
    }

    // Renderizar solicitudes públicas primero
    publicRequests.forEach((doc) => {
        const requestDocId = doc.id;
        const requestData = doc.data();
        const score = requestData.creditScoreSnapshot || 5.0;
        const starHtml = Array(Math.round(score)).fill('★').join('') + Array(5 - Math.round(score)).fill('☆').join('');

        const item = document.createElement('li');
        item.className = 'bg-gray-50 p-3 rounded-lg border border-gray-200';
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-bold text-lg text-red-600">$${requestData.amount.toFixed(2)}</p>
                    <p class="text-xs text-gray-500">Deudor: ${requestData.debtorName}</p>
                    <p class="text-xs text-gray-500 break-all">ID: ${requestData.debtorId}</p>
                    <p class="text-xs text-blue-600 mt-1">${requestData.description || 'Sin descripción'}</p>
                </div>
                <div class="text-right">
                    <p class="text-sm font-semibold text-green-700">${requestData.interestRate.toFixed(2)}% Int.</p>
                    <p class="text-xs text-yellow-500 mt-1" title="Score de Crédito">${starHtml} (${score.toFixed(1)})</p>
                </div>
            </div>
            <div class="mt-3 flex gap-2">
                <button class="lend-on-request-btn flex-1 py-1 px-3 rounded-full text-xs font-semibold text-white btn-primary" data-id="${requestDocId}">Aceptar</button>
                <button class="reject-request-btn flex-1 py-1 px-3 rounded-full text-xs font-semibold text-gray-800 btn-secondary" data-id="${requestDocId}">Rechazar</button>
            </div>
        `;
        loanRequestsList.appendChild(item);
    });

    // Separador y 'Mis solicitudes' (si existen)
    if (myRequests.length > 0) {
        const header = document.createElement('li');
        header.className = 'text-sm font-semibold text-gray-700 mt-3 mb-1';
        header.innerHTML = '<p class="underline">Mis solicitudes</p>';
        loanRequestsList.appendChild(header);

        myRequests.forEach((doc) => {
            const requestDocId = doc.id;
            const requestData = doc.data();
            const score = requestData.creditScoreSnapshot || 5.0;
            const starHtml = Array(Math.round(score)).fill('★').join('') + Array(5 - Math.round(score)).fill('☆').join('');

            const item = document.createElement('li');
            item.className = 'bg-gray-50 p-3 rounded-lg border border-gray-200';
            item.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-bold text-lg text-red-600">$${requestData.amount.toFixed(2)}</p>
                        <p class="text-xs text-gray-500">Deudor: ${requestData.debtorName}</p>
                        <p class="text-xs text-gray-500 break-all">ID: ${requestData.debtorId}</p>
                        <p class="text-xs text-blue-600 mt-1">${requestData.description || 'Sin descripción'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-semibold text-green-700">${requestData.interestRate.toFixed(2)}% Int.</p>
                        <p class="text-xs text-yellow-500 mt-1" title="Score de Crédito">${starHtml} (${score.toFixed(1)})</p>
                    </div>
                </div>
                <button class="cancel-request-btn mt-3 w-full py-2 px-4 rounded-full text-md font-semibold text-white bg-red-500 hover:bg-red-600 transition" data-id="${requestDocId}">Cancelar Solicitud</button>
            `;
            loanRequestsList.appendChild(item);
        });
    }
    
    // Listener para Aceptar Oferta (Prestar)
    loanRequestsList.querySelectorAll('.lend-on-request-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const docId = button.dataset.id;
            const requestDoc = await getDoc(doc(db, `artifacts/${appId}/loan-requests/${docId}`));
            if (requestDoc.exists()) {
                // Se muestra diálogo de confirmación en lendOnRequest
                await lendOnRequest(docId, requestDoc.data());
            }
        });
    });
    // Listener para Cancelar Solicitud (propias)
    loanRequestsList.querySelectorAll('.cancel-request-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const docId = button.dataset.id;
            if (!docId) return;
            
            const confirmed = await showConfirmModal(
                'Cancelar Solicitud de Préstamo',
                'Cancelarás esta solicitud. ¿Deseas continuar?<br><br><strong>Esta acción no se puede deshacer.</strong>',
                'warning'
            );
            if (!confirmed) return;
            
            try {
                await cancelLoanRequest(docId);
            } catch (err) {
                console.error('Error al cancelar la solicitud desde el listener:', err);
            }
        });
    });
    // Listener para Rechazar Solicitud (ocultarla solo para el usuario que la rechaza)
    loanRequestsList.querySelectorAll('.reject-request-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const docId = button.dataset.id;
            if (!docId) return;
            
            const confirmed = await showConfirmModal(
                'Rechazar Solicitud',
                '¿Rechazas esta solicitud? Ya no se mostrará en tu lista.',
                'info'
            );
            if (!confirmed) return;
            
            try {
                await updateDoc(doc(db, `artifacts/${appId}/loan-requests/${docId}`), { rejectedBy: arrayUnion(userId) });
                showMessage('Solicitud rechazada. Ya no se mostrará en tu lista.', 'info');
            } catch (err) {
                console.error('Error al rechazar la solicitud:', err);
                showMessage(`Error al rechazar la solicitud: ${err.message}`, 'error');
            }
        });
    });
});
}
// [/ADICIÓN: Función para escuchar Solicitudes de Préstamo]

// --- EXPORTAR HISTORIAL A PDF ---
async function exportTransactionsToPDF(userId) {
    if (!userId) { showMessage('Usuario no autenticado.', 'error'); return; }
    showMessage('Generando PDF...', 'info');
    try {
        const transactionsRef = collection(db, `artifacts/${appId}/users/${userId}/transactions`);
        const q = query(transactionsRef, orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        if (snapshot.empty) { showMessage('No hay transacciones para exportar.', 'info'); return; }

        const rows = snapshot.docs.map(d => {
            const t = d.data();
            const date = t.timestamp && t.timestamp.toDate ? t.timestamp.toDate().toLocaleString('es-ES') : '';
            const desc = t.description || t.type || '';
            const type = t.type || '';
            const amount = (typeof t.amount === 'number') ? t.amount.toFixed(2) : (t.paidAmount ? t.paidAmount.toFixed(2) : '');
            const status = t.status || '';
            return [date, desc, type, amount, status];
        });

        // Get jsPDF constructor (support different global shapes)
        let jsPDFCtor = null;
        if (window.jspdf && window.jspdf.jsPDF) jsPDFCtor = window.jspdf.jsPDF;
        else if (window.jsPDF) jsPDFCtor = window.jsPDF;
        else if (typeof window.jspdf === 'function') jsPDFCtor = window.jspdf;

        if (!jsPDFCtor) throw new Error('jsPDF no está disponible.');

        const pdfDoc = new jsPDFCtor('p','pt','a4');
        pdfDoc.setFontSize(14);
        pdfDoc.text(`Historial de Transacciones - ${userNameDisplay.textContent || ''}`, 40, 40);
        pdfDoc.setFontSize(10);
        pdfDoc.text(`ID: ${userId}`, 40, 56);

        // Add table with autoTable
        pdfDoc.autoTable({
            head: [['Fecha','Descripción','Tipo','Monto','Estado']],
            body: rows,
            startY: 80,
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [59,130,246], textColor: 255 }
        });

        const filename = `historial_${userId}.pdf`;
        pdfDoc.save(filename);
        showMessage('PDF descargado.', 'success');
    } catch (err) {
        console.error('Error generando PDF:', err);
        showMessage('Error generando PDF: ' + (err.message || err), 'error');
    }
}

// Handler para botón Exportar PDF
const exportBtn = document.getElementById('export-pdf-btn');
if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
        if (!currentUser) { showMessage('Debes iniciar sesión para exportar.','error'); return; }
        await exportTransactionsToPDF(currentUser.uid);
    });
}