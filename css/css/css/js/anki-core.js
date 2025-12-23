// Anki Core Engine
class AnkiCore {
    constructor() {
        this.version = '2.1.66';
        this.db = null;
        this.decks = [];
        this.currentDeck = null;
        this.cards = [];
        this.currentCard = null;
        this.scheduler = new AnkiScheduler();
        this.state = {
            isStudying: false,
            isFlipped: false,
            studyQueue: [],
            studyIndex: 0
        };
    }

    // Initialize Database
    async init() {
        await this.initDB();
        await this.loadDecks();
        await this.loadCards();
        this.updateStats();
        
        // Add default decks if none exist
        if (this.decks.length === 0) {
            await this.createDefaultDecks();
        }
        
        return this;
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('anki-pwa', 3);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Decks store
                if (!db.objectStoreNames.contains('decks')) {
                    const store = db.createObjectStore('decks', { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: true });
                }
                
                // Cards store
                if (!db.objectStoreNames.contains('cards')) {
                    const store = db.createObjectStore('cards', { keyPath: 'id' });
                    store.createIndex('deckId', 'deckId');
                    store.createIndex('due', 'due');
                    store.createIndex('queue', 'queue');
                }
                
                // Notes store
                if (!db.objectStoreNames.contains('notes')) {
                    const store = db.createObjectStore('notes', { keyPath: 'id' });
                    store.createIndex('deckId', 'deckId');
                }
                
                // Reviews store
                if (!db.objectStoreNames.contains('reviews')) {
                    db.createObjectStore('reviews', { keyPath: 'id' });
                }
                
                // Models store (note types)
                if (!db.objectStoreNames.contains('models')) {
                    const store = db.createObjectStore('models', { keyPath: 'id' });
                    // Create default models
                    const tx = store.transaction(db, 'readwrite');
                    this.createDefaultModels(tx.objectStore('models'));
                }
            };
        });
    }

    createDefaultModels(store) {
        const models = [
            {
                id: 'basic',
                name: 'Basic',
                fields: ['Front', 'Back'],
                templates: [
                    {
                        name: 'Card 1',
                        qfmt: '{{Front}}',
                        afmt: '{{FrontSide}}<hr id=answer>{{Back}}'
                    }
                ]
            },
            {
                id: 'basic-reversed',
                name: 'Basic (and reversed card)',
                fields: ['Front', 'Back'],
                templates: [
                    {
                        name: 'Card 1',
                        qfmt: '{{Front}}',
                        afmt: '{{FrontSide}}<hr id=answer>{{Back}}'
                    },
                    {
                        name: 'Card 2',
                        qfmt: '{{Back}}',
                        afmt: '{{FrontSide}}<hr id=answer>{{Front}}'
                    }
                ]
            },
            {
                id: 'cloze',
                name: 'Cloze',
                fields: ['Text', 'Extra'],
                templates: [
                    {
                        name: 'Cloze',
                        qfmt: '{{cloze:Text}}',
                        afmt: '{{cloze:Text}}<br>{{Extra}}'
                    }
                ]
            }
        ];
        
        models.forEach(model => store.add(model));
    }

    async createDefaultDecks() {
        const defaultDeck = {
            id: 'default',
            name: 'Default',
            desc: '',
            conf: 1,
            mod: Date.now(),
            usn: -1,
            collapsed: false,
            browserCollapsed: false,
            newToday: [0, 0],
            revToday: [0, 0],
            timeToday: [0, 0],
            dyn: 0,
            extendRev: 0,
            extendNew: 0
        };
        
        await this.saveDeck(defaultDeck);
        await this.loadDecks();
    }

    async loadDecks() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('decks', 'readonly');
            const store = tx.objectStore('decks');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.decks = request.result;
                resolve(this.decks);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async loadCards() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('cards', 'readonly');
            const store = tx.objectStore('cards');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.cards = request.result;
                resolve(this.cards);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveDeck(deck) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('decks', 'readwrite');
            const store = tx.objectStore('decks');
            const request = store.put(deck);
            
            request.onsuccess = () => resolve(deck);
            request.onerror = () => reject(request.error);
        });
    }

    async saveCard(card) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('cards', 'readwrite');
            const store = tx.objectStore('cards');
            const request = store.put(card);
            
            request.onsuccess = () => resolve(card);
            request.onerror = () => reject(request.error);
        });
    }

    async addNote(note) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['notes', 'cards'], 'readwrite');
            const notesStore = tx.objectStore('notes');
            const cardsStore = tx.objectStore('cards');
            
            // Save note
            const noteRequest = notesStore.add(note);
            
            noteRequest.onsuccess = () => {
                const noteId = noteRequest.result;
                
                // Create cards from note
                const model = this.getModel(note.mid);
                if (model) {
                    model.templates.forEach((template, idx) => {
                        const card = {
                            id: Date.now() + idx,
                            nid: noteId,
                            did: note.did,
                            ord: idx,
                            mod: Date.now(),
                            usn: -1,
                            type: 0, // new
                            queue: 0,
                            due: 0,
                            ivl: 0,
                            factor: 2500,
                            reps: 0,
                            lapses: 0,
                            left: 0,
                            odue: 0,
                            odid: 0,
                            flags: 0,
                            data: ''
                        };
                        
                        cardsStore.add(card);
                    });
                }
                
                resolve(noteId);
            };
            
            noteRequest.onerror = () => reject(noteRequest.error);
        });
    }

    getModel(modelId) {
        // In real implementation, load from IndexedDB
        const models = {
            'basic': {
                id: 'basic',
                name: 'Basic',
                fields: ['Front', 'Back'],
                templates: [{ qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }]
            },
            'cloze': {
                id: 'cloze',
                name: 'Cloze',
                fields: ['Text', 'Extra'],
                templates: [{ qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }]
            }
        };
        
        return models[modelId];
    }

    async getDueCards(deckId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('cards', 'readonly');
            const store = tx.objectStore('cards');
            const dueIndex = store.index('due');
            
            // Get cards due today or earlier
            const today = Math.floor(Date.now() / 86400000);
            const range = IDBKeyRange.upperBound(today);
            const request = dueIndex.getAll(range);
            
            request.onsuccess = () => {
                let cards = request.result;
                if (deckId) {
                    cards = cards.filter(card => card.did === deckId);
                }
                
                // Sort by type and due date
                cards.sort((a, b) => {
                    if (a.queue !== b.queue) return a.queue - b.queue;
                    return a.due - b.due;
                });
                
                resolve(cards);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async startStudySession(deckId) {
        const dueCards = await this.getDueCards(deckId);
        this.state.studyQueue = dueCards;
        this.state.studyIndex = 0;
        this.state.isStudying = true;
        this.state.isFlipped = false;
        
        if (dueCards.length > 0) {
            this.currentCard = dueCards[0];
            return this.currentCard;
        }
        
        return null;
    }

    answerCard(rating) {
        if (!this.currentCard) return null;
        
        const scheduled = this.scheduler.answerCard(this.currentCard, rating);
        this.saveCard(scheduled);
        
        // Record review
        this.recordReview(this.currentCard.id, rating);
        
        // Move to next card
        this.state.studyIndex++;
        if (this.state.studyIndex < this.state.studyQueue.length) {
            this.currentCard = this.state.studyQueue[this.state.studyIndex];
            this.state.isFlipped = false;
        } else {
            this.currentCard = null;
            this.state.isStudying = false;
        }
        
        this.updateStats();
        return this.currentCard;
    }

    recordReview(cardId, rating) {
        const review = {
            id: Date.now(),
            cid: cardId,
            usn: -1,
            ease: rating,
            ivl: 0,
            lastIvl: 0,
            factor: 0,
            time: 0,
            type: 0
        };
        
        const tx = this.db.transaction('reviews', 'readwrite');
        const store = tx.objectStore('reviews');
        store.add(review);
    }

    updateStats() {
        // Calculate total due and new cards
        let totalDue = 0;
        let totalNew = 0;
        
        this.decks.forEach(deck => {
            // In real implementation, calculate from cards
            const deckCards = this.cards.filter(c => c.did === deck.id);
            totalDue += deckCards.filter(c => c.queue === 2 || c.queue === 3).length;
            totalNew += deckCards.filter(c => c.queue === 0).length;
        });
        
        // Update UI
        document.getElementById('total-due').textContent = totalDue;
        document.getElementById('total-new').textContent = totalNew;
        document.getElementById('status-cards').textContent = this.cards.length;
        document.getElementById('status-due').textContent = totalDue;
        document.getElementById('status-new').textContent = totalNew;
    }

    // Cloze parsing
    parseCloze(text) {
        const clozeRegex = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
        const holes = [];
        let match;
        
        // Find all cloze deletions
        while ((match = clozeRegex.exec(text)) !== null) {
            holes.push({
                number: parseInt(match[1]),
                text: match[2],
                hint: match[3] || ''
            });
        }
        
        // Generate question text (with holes replaced by [...])
        let question = text.replace(clozeRegex, (match, num, content, hint) => {
            return hint ? `[${hint}]` : '[...]';
        });
        
        // Generate answer text (with highlighted answers)
        let answer = text.replace(clozeRegex, (match, num, content, hint) => {
            return `<span class="cloze-answer">${content}</span>`;
        });
        
        return { question, answer, holes };
    }

    // Import/Export
    async exportDeck(deckId) {
        const deck = this.decks.find(d => d.id === deckId);
        if (!deck) return null;
        
        const cards = this.cards.filter(c => c.did === deckId);
        
        return {
            deck,
            cards,
            exported: new Date().toISOString(),
            version: this.version
        };
    }

    async importDeck(data) {
        // Import logic here
        console.log('Importing deck:', data);
        return true;
    }
}

// Initialize global Anki instance
window.Anki = new AnkiCore();
