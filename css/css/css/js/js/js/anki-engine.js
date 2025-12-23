// Core Anki Engine

class AnkiEngine {
    constructor() {
        this.db = window.AnkiDB;
        this.scheduler = window.AnkiScheduler;
        this.currentDeck = null;
        this.currentCard = null;
        this.studyQueue = [];
        this.studyIndex = 0;
        this.isFlipped = false;
    }

    async init() {
        try {
            await this.db.init();
            await this.db.createDefaultData();
            
            const decks = await this.db.getDecks();
            if (decks.length > 0) {
                this.currentDeck = decks[0];
            }
            
            console.log('Anki Engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize Anki Engine:', error);
            return false;
        }
    }

    // Deck operations
    async getDecks() {
        return this.db.getDecks();
    }

    async getDeckStats(deckId) {
        return this.db.getDeckStats(deckId);
    }

    async createDeck(name, parentId = null) {
        const deck = {
            id: 'deck-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            name: name,
            desc: '',
            parentId: parentId,
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
        
        await this.db.saveDeck(deck);
        return deck;
    }

    // Card operations
    async startStudySession(deckId) {
        this.currentDeck = await this.db.getDeck(deckId);
        this.studyQueue = await this.db.getDueCards(deckId, 100);
        this.studyIndex = 0;
        this.isFlipped = false;
        
        if (this.studyQueue.length > 0) {
            this.currentCard = this.studyQueue[0];
            return this.getCardContent(this.currentCard);
        }
        
        return null;
    }

    async getCardContent(card) {
        const note = await this.db.getNote(card.noteId);
        const model = await this.db.getModel(note.model);
        
        if (!note || !model) return null;
        
        // Get template
        const template = model.templates[card.template || 0];
        
        // Render question
        let question = template.qfmt;
        let answer = template.afmt;
        
        // Replace fields
        for (const fieldName in note.fields) {
            const fieldValue = note.fields[fieldName] || '';
            const regex = new RegExp(`{{${fieldName}}}`, 'g');
            question = question.replace(regex, fieldValue);
            answer = answer.replace(regex, fieldValue);
        }
        
        // Handle cloze
        if (model.id === 'cloze') {
            const clozeData = this.parseCloze(note.fields.Text || '');
            question = question.replace('{{cloze:Text}}', clozeData.question);
            answer = answer.replace('{{cloze:Text}}', clozeData.answer);
        }
        
        // Replace FrontSide
        answer = answer.replace(/{{FrontSide}}/g, question);
        
        return {
            cardId: card.id,
            question: this.sanitizeHTML(question),
            answer: this.sanitizeHTML(answer),
            type: this.scheduler.getCardType(card),
            deckId: card.deckId,
            noteType: model.name
        };
    }

    parseCloze(text) {
        const clozeRegex = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
        let question = text;
        let answer = text;
        let match;
        
        while ((match = clozeRegex.exec(text)) !== null) {
            const [full, num, content, hint] = match;
            question = question.replace(full, hint ? `[${hint}]` : '[...]');
            answer = answer.replace(full, `<span class="cloze-answer">${content}</span>`);
        }
        
        // Remove any remaining cloze markers
        question = question.replace(/\{\{c\d+::/g, '[...]').replace(/\}\}/g, '');
        answer = answer.replace(/\{\{c\d+::/g, '').replace(/\}\}/g, '');
        
        return { question, answer };
    }

    sanitizeHTML(html) {
        const div = document.createElement('div');
        div.textContent = html;
        return div.innerHTML;
    }

    async answerCurrentCard(rating) {
        if (!this.currentCard) return null;
        
        // Update card with scheduler
        const updatedCard = this.scheduler.answerCard(this.currentCard, rating);
        
        // Save updated card
        await this.db.saveCard(updatedCard);
        
        // Record review
        await this.db.saveReview({
            cardId: this.currentCard.id,
            rating: rating,
            time: Date.now(),
            interval: updatedCard.interval,
            ease: updatedCard.ease
        });
        
        // Move to next card
        this.studyIndex++;
        this.isFlipped = false;
        
        if (this.studyIndex < this.studyQueue.length) {
            this.currentCard = this.studyQueue[this.studyIndex];
            return this.getCardContent(this.currentCard);
        } else {
            this.currentCard = null;
            return null; // Study session complete
        }
    }

    async addNote(deckId, modelId, fields, tags = []) {
        const noteId = 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        const note = {
            id: noteId,
            deckId: deckId,
            model: modelId,
            fields: fields,
            tags: tags,
            created: Date.now(),
            modified: Date.now()
        };
        
        await this.db.saveNote(note);
        
        // Create cards from note
        const model = await this.db.getModel(modelId);
        if (model && model.templates) {
            for (let i = 0; i < model.templates.length; i++) {
                const cardId = 'card-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                
                const card = {
                    id: cardId,
                    noteId: noteId,
                    deckId: deckId,
                    template: i,
                    queue: 0, // New
                    type: 0,
                    due: Date.now(),
                    interval: 0,
                    ease: this.scheduler.config.initialEase,
                    factor: Math.round(this.scheduler.config.initialEase * 1000),
                    reviews: 0,
                    lapses: 0,
                    remainingSteps: 0,
                    created: Date.now()
                };
                
                await this.db.saveCard(card);
            }
        }
        
        return noteId;
    }

    async searchCards(query, deckId = null) {
        const notes = await this.db.getNotes(deckId);
        const cards = await this.db.getCards(deckId);
        
        if (!query || query.trim() === '') {
            // Return all cards if no query
            return cards.slice(0, 100);
        }
        
        const searchTerm = query.toLowerCase().trim();
        const matchingNoteIds = new Set();
        
        // Search in notes
        for (const note of notes) {
            let match = false;
            
            // Search in fields
            for (const fieldValue of Object.values(note.fields)) {
                if (fieldValue.toLowerCase().includes(searchTerm)) {
                    match = true;
                    break;
                }
            }
            
            // Search in tags
            if (note.tags && note.tags.some(tag => tag.toLowerCase().includes(searchTerm))) {
                match = true;
            }
            
            if (match) {
                matchingNoteIds.add(note.id);
            }
        }
        
        // Filter cards by matching notes
        const matchingCards = cards.filter(card => matchingNoteIds.has(card.noteId));
        
        return matchingCards.slice(0, 100);
    }

    async getStats() {
        const decks = await this.db.getDecks();
        const cards = await this.db.getCards();
        
        let totalCards = 0;
        let totalDue = 0;
        let totalNew = 0;
        let totalLearning = 0;
        let totalReview = 0;
        
        for (const deck of decks) {
            const stats = await this.db.getDeckStats(deck.id);
            totalCards += stats.total;
            totalDue += stats.due;
            totalNew += stats.new;
            totalLearning += stats.learning;
            totalReview += stats.review;
        }
        
        return {
            totalCards,
            totalDue,
            totalNew,
            totalLearning,
            totalReview,
            deckCount: decks.length
        };
    }

    async exportDeck(deckId) {
        const deck = await this.db.getDeck(deckId);
        const cards = await this.db.getCards(deckId);
        const notes = await this.db.getNotes(deckId);
        
        return {
            deck,
            cards,
            notes,
            exported: new Date().toISOString(),
            version: '2.1.66'
        };
    }

    async importDeck(data) {
        // Validate data
        if (!data.deck || !data.cards || !data.notes) {
            throw new Error('Invalid deck data');
        }
        
        // Save deck
        await this.db.saveDeck(data.deck);
        
        // Save notes
        for (const note of data.notes) {
            await this.db.saveNote(note);
        }
        
        // Save cards
        for (const card of data.cards) {
            await this.db.saveCard(card);
        }
        
        return true;
    }

    async resetAllData() {
        // This would delete all data - use with caution
        // In production, you might want to implement a more sophisticated reset
        console.warn('Resetting all data - this cannot be undone!');
        
        // Clear all object stores
        const storeNames = ['decks', 'cards', 'notes', 'reviews', 'config'];
        
        for (const storeName of storeNames) {
            const tx = this.db.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const clearRequest = store.clear();
            
            await new Promise((resolve, reject) => {
                clearRequest.onsuccess = resolve;
                clearRequest.onerror = reject;
            });
        }
        
        // Recreate default data
        await this.db.createDefaultData();
        
        return true;
    }
}

// Export engine instance
window.AnkiEngine = new AnkiEngine();
