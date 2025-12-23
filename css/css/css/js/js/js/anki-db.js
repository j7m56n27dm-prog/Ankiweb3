// Database operations for Anki
class AnkiDB {
    static async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('anki-desktop', 4);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create all object stores exactly like Anki
                this.createStores(db);
                
                // Add default data
                event.target.transaction.oncomplete = () => {
                    this.addDefaultData();
                };
            };
        });
    }

    static createStores(db) {
        // Decks
        if (!db.objectStoreNames.contains('decks')) {
            const deckStore = db.createObjectStore('decks', { keyPath: 'id' });
            deckStore.createIndex('name', 'name', { unique: false });
        }
        
        // Cards
        if (!db.objectStoreNames.contains('cards')) {
            const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
            cardStore.createIndex('did', 'did');
            cardStore.createIndex('due', 'due');
            cardStore.createIndex('queue', 'queue');
            cardStore.createIndex('nid', 'nid');
        }
        
        // Notes
        if (!db.objectStoreNames.contains('notes')) {
            const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
            noteStore.createIndex('mid', 'mid');
            noteStore.createIndex('tags', 'tags');
        }
        
        // Models (Note Types)
        if (!db.objectStoreNames.contains('models')) {
            const modelStore = db.createObjectStore('models', { keyPath: 'id' });
        }
        
        // Reviews
        if (!db.objectStoreNames.contains('reviews')) {
            db.createObjectStore('reviews', { keyPath: 'id' });
        }
        
        // Configuration
        if (!db.objectStoreNames.contains('config')) {
            const configStore = db.createObjectStore('config', { keyPath: 'key' });
        }
    }

    static async addDefaultData() {
        // Add default models
        const models = [
            {
                id: 1,
                name: 'Basic',
                type: 0,
                mod: Date.now(),
                usn: -1,
                sortf: 0,
                did: 1,
                tmpls: [
                    {
                        name: 'Card 1',
                        ord: 0,
                        qfmt: '{{Front}}',
                        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}'
                    }
                ],
                flds: [
                    { name: 'Front', ord: 0, media: [] },
                    { name: 'Back', ord: 1, media: [] }
                ],
                req: [[0, 'any', [0]]]
            },
            {
                id: 2,
                name: 'Basic (and reversed card)',
                type: 0,
                mod: Date.now(),
                usn: -1,
                sortf: 0,
                did: 1,
                tmpls: [
                    {
                        name: 'Card 1',
                        ord: 0,
                        qfmt: '{{Front}}',
                        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}'
                    },
                    {
                        name: 'Card 2',
                        ord: 1,
                        qfmt: '{{Back}}',
                        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}'
                    }
                ],
                flds: [
                    { name: 'Front', ord: 0, media: [] },
                    { name: 'Back', ord: 1, media: [] }
                ],
                req: [[0, 'any', [0]], [1, 'any', [1]]]
            },
            {
                id: 3,
                name: 'Cloze',
                type: 1,
                mod: Date.now(),
                usn: -1,
                sortf: 0,
                did: 1,
                tmpls: [
                    {
                        name: 'Cloze',
                        ord: 0,
                        qfmt: '{{cloze:Text}}',
                        afmt: '{{cloze:Text}}<br>\n{{Extra}}'
                    }
                ],
                flds: [
                    { name: 'Text', ord: 0, media: [] },
                    { name: 'Extra', ord: 1, media: [] }
                ],
                req: [[0, 'any', [0]]]
            }
        ];
        
        await Promise.all(models.map(model => this.saveModel(model)));
        
        // Add default deck
        const defaultDeck = {
            id: 1,
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
    }

    // CRUD Operations
    static async saveDeck(deck) {
        return this._put('decks', deck);
    }

    static async getDecks() {
        return this._getAll('decks');
    }

    static async saveCard(card) {
        return this._put('cards', card);
    }

    static async getCards(deckId = null) {
        const cards = await this._getAll('cards');
        if (!deckId) return cards;
        return cards.filter(card => card.did === deckId);
    }

    static async saveNote(note) {
        return this._put('notes', note);
    }

    static async saveModel(model) {
        return this._put('models', model);
    }

    static async getModels() {
        return this._getAll('models');
    }

    // Helper methods
    static _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    static _getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async getDueCards(deckId = null) {
        const cards = await this.getCards(deckId);
        const now = Math.floor(Date.now() / 86400000);
        
        return cards.filter(card => {
            if (card.queue === 0) return true; // New cards
            if (card.queue === 1 || card.queue === 3) {
                // Learning/relearning cards
                const dueTime = card.due;
                return dueTime <= Math.floor(Date.now() / 1000);
            }
            if (card.queue === 2) {
                // Review cards
                return card.due <= now;
            }
            return false;
        }).sort((a, b) => {
            // Sort by queue, then due
            if (a.queue !== b.queue) return a.queue - b.queue;
            return a.due - b.due;
        });
    }
}

// Make globally available
window.AnkiDB = AnkiDB;
