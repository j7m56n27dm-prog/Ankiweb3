// IndexedDB Database for Anki

class AnkiDatabase {
    constructor() {
        this.db = null;
        this.DB_NAME = 'anki-desktop-pwa';
        this.DB_VERSION = 3;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = (event) => {
                reject(new Error('Database error: ' + event.target.error));
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('Database initialized');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object stores
                if (!db.objectStoreNames.contains('decks')) {
                    const decksStore = db.createObjectStore('decks', { keyPath: 'id' });
                    decksStore.createIndex('name', 'name', { unique: false });
                    decksStore.createIndex('parentId', 'parentId', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('cards')) {
                    const cardsStore = db.createObjectStore('cards', { keyPath: 'id' });
                    cardsStore.createIndex('deckId', 'deckId', { unique: false });
                    cardsStore.createIndex('due', 'due', { unique: false });
                    cardsStore.createIndex('type', 'type', { unique: false });
                    cardsStore.createIndex('queue', 'queue', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('notes')) {
                    const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
                    notesStore.createIndex('deckId', 'deckId', { unique: false });
                    notesStore.createIndex('model', 'model', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('models')) {
                    const modelsStore = db.createObjectStore('models', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('reviews')) {
                    db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
                }
                
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'key' });
                }
                
                console.log('Database schema created');
            };
        });
    }

    // Deck operations
    async saveDeck(deck) {
        return this._put('decks', deck);
    }

    async getDecks() {
        return this._getAll('decks');
    }

    async getDeck(id) {
        return this._get('decks', id);
    }

    async deleteDeck(id) {
        return this._delete('decks', id);
    }

    // Card operations
    async saveCard(card) {
        return this._put('cards', card);
    }

    async getCards(deckId = null) {
        const cards = await this._getAll('cards');
        if (!deckId) return cards;
        return cards.filter(card => card.deckId === deckId);
    }

    async getDueCards(deckId = null, limit = 100) {
        const now = Math.floor(Date.now() / 1000);
        const today = Math.floor(Date.now() / 86400000);
        
        const cards = await this._getAll('cards');
        
        // Filter cards due
        let dueCards = cards.filter(card => {
            if (card.queue === 0) return true; // New cards
            if (card.queue === 1 || card.queue === 3) return card.due <= now; // Learning/Relearning
            if (card.queue === 2) return card.due <= today; // Review
            return false;
        });
        
        // Filter by deck if specified
        if (deckId) {
            dueCards = dueCards.filter(card => card.deckId === deckId);
        }
        
        // Sort by priority
        dueCards.sort((a, b) => {
            const priority = { 1: 0, 3: 1, 2: 2, 0: 3 }; // Learning first, then relearning, review, new
            return (priority[a.queue] || 4) - (priority[b.queue] || 4);
        });
        
        return dueCards.slice(0, limit);
    }

    // Note operations
    async saveNote(note) {
        return this._put('notes', note);
    }

    async getNote(id) {
        return this._get('notes', id);
    }

    async getNotes(deckId = null) {
        const notes = await this._getAll('notes');
        if (!deckId) return notes;
        return notes.filter(note => note.deckId === deckId);
    }

    // Model operations
    async saveModel(model) {
        return this._put('models', model);
    }

    async getModels() {
        return this._getAll('models');
    }

    async getModel(id) {
        return this._get('models', id);
    }

    // Review operations
    async saveReview(review) {
        return this._add('reviews', review);
    }

    async getReviews(cardId = null) {
        const reviews = await this._getAll('reviews');
        if (!cardId) return reviews;
        return reviews.filter(review => review.cardId === cardId);
    }

    // Config operations
    async saveConfig(key, value) {
        return this._put('config', { key, value });
    }

    async getConfig(key) {
        const config = await this._get('config', key);
        return config ? config.value : null;
    }

    // Generic database operations
    _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(data);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _add(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);
            
            request.onsuccess = () => resolve(data);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // Statistics
    async getDeckStats(deckId) {
        const cards = await this.getCards(deckId);
        const now = Math.floor(Date.now() / 1000);
        const today = Math.floor(Date.now() / 86400000);
        
        let due = 0;
        let newCards = 0;
        let learning = 0;
        let review = 0;
        
        cards.forEach(card => {
            if (card.queue === 0) newCards++;
            if (card.queue === 1 || card.queue === 3) {
                if (card.due <= now) learning++;
            }
            if (card.queue === 2) {
                if (card.due <= today) review++;
            }
        });
        
        due = learning + review;
        
        return {
            total: cards.length,
            due,
            new: newCards,
            learning,
            review
        };
    }

    // Create default data if empty
    async createDefaultData() {
        const decks = await this.getDecks();
        if (decks.length > 0) return;
        
        // Create default deck
        const defaultDeck = {
            id: 'default',
            name: 'Default',
            desc: 'Default deck',
            parentId: null,
            config: {
                newPerDay: 20,
                reviewsPerDay: 200,
                learningSteps: [1, 10],
                graduatingInterval: 1,
                easyInterval: 4,
                initialEase: 2.5,
                easyBonus: 1.3,
                intervalModifier: 1.0,
                hardInterval: 1.2,
                lapses: {
                    steps: [10],
                    newInterval: 0.5,
                    minimumInterval: 1,
                    leechThreshold: 8
                }
            },
            created: Date.now(),
            modified: Date.now()
        };
        
        await this.saveDeck(defaultDeck);
        
        // Create default models
        const models = [
            {
                id: 'basic',
                name: 'Basic',
                fields: ['Front', 'Back'],
                templates: [
                    {
                        name: 'Card 1',
                        qfmt: '{{Front}}',
                        afmt: '{{FrontSide}}\n<hr id="answer">\n{{Back}}'
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
                        afmt: '{{FrontSide}}\n<hr id="answer">\n{{Back}}'
                    },
                    {
                        name: 'Card 2',
                        qfmt: '{{Back}}',
                        afmt: '{{FrontSide}}\n<hr id="answer">\n{{Front}}'
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
                        afmt: '{{cloze:Text}}\n{{Extra}}'
                    }
                ]
            }
        ];
        
        for (const model of models) {
            await this.saveModel(model);
        }
        
        // Add some sample cards
        await this.createSampleCards(defaultDeck.id);
        
        console.log('Default data created');
    }

    async createSampleCards(deckId) {
        const sampleNotes = [
            {
                id: 'sample-basic-1',
                deckId: deckId,
                model: 'basic',
                fields: {
                    Front: 'What is the capital of France?',
                    Back: 'Paris'
                },
                tags: ['geography', 'capital'],
                created: Date.now()
            },
            {
                id: 'sample-cloze-1',
                deckId: deckId,
                model: 'cloze',
                fields: {
                    Text: 'The {{c1::capital}} of France is {{c1::Paris}}.',
                    Extra: 'Paris is known as the City of Light.'
                },
                tags: ['geography', 'cloze'],
                created: Date.now()
            }
        ];
        
        for (const note of sampleNotes) {
            await this.saveNote(note);
            
            // Create cards from note
            const model = await this.getModel(note.model);
            if (model) {
                for (let i = 0; i < model.templates.length; i++) {
                    const card = {
                        id: `${note.id}-card-${i}`,
                        noteId: note.id,
                        deckId: deckId,
                        template: i,
                        queue: 0, // New
                        type: 0,
                        due: Date.now(),
                        interval: 0,
                        ease: 2.5,
                        factor: 2500,
                        reviews: 0,
                        lapses: 0,
                        remainingSteps: 0,
                        created: Date.now()
                    };
                    
                    await this.saveCard(card);
                }
            }
        }
    }
}

// Export database instance
window.AnkiDB = new AnkiDatabase();
