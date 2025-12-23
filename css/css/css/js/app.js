// Main Application Entry Point
class AnkiApp {
    constructor() {
        this.core = null;
        this.currentDeck = null;
        this.currentView = 'deck-overview';
        this.isStudying = false;
        this.currentCard = null;
        this.studyQueue = [];
        this.studyIndex = 0;
        this.isFlipped = false;
        
        this.init();
    }

    async init() {
        try {
            // Initialize core systems
            await this.initDatabase();
            await this.loadDecks();
            this.setupEventListeners();
            this.setupGestures();
            this.setupPWA();
            this.updateUI();
            
            console.log('Anki PWA initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Anki:', error);
            this.showError('Failed to initialize application. Please refresh.');
        }
    }

    async initDatabase() {
        // Initialize IndexedDB
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('anki-desktop-pwa', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object stores
                if (!db.objectStoreNames.contains('decks')) {
                    db.createObjectStore('decks', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('cards')) {
                    const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
                    cardStore.createIndex('deckId', 'deckId');
                    cardStore.createIndex('due', 'due');
                }
                
                if (!db.objectStoreNames.contains('notes')) {
                    db.createObjectStore('notes', { keyPath: 'id' });
                }
            };
        });
    }

    async loadDecks() {
        // Load decks from database or create default
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('decks', 'readonly');
            const store = tx.objectStore('decks');
            const request = store.getAll();
            
            request.onsuccess = async () => {
                let decks = request.result;
                
                if (decks.length === 0) {
                    // Create default deck
                    const defaultDeck = {
                        id: 'default',
                        name: 'Default',
                        desc: 'Default deck',
                        created: Date.now(),
                        modified: Date.now(),
                        options: {
                            newPerDay: 20,
                            reviewPerDay: 200,
                            learningSteps: [1, 10],
                            graduatingInterval: 1,
                            easyInterval: 4
                        }
                    };
                    
                    await this.saveDeck(defaultDeck);
                    decks = [defaultDeck];
                }
                
                this.decks = decks;
                this.currentDeck = decks[0];
                resolve(decks);
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

    setupEventListeners() {
        // Deck selection
        document.addEventListener('click', (e) => {
            const deckItem = e.target.closest('.deck-item');
            if (deckItem) {
                const deckId = deckItem.dataset.deckId;
                this.selectDeck(deckId);
            }
        });
        
        // Toolbar buttons
        document.getElementById('study-btn').addEventListener('click', () => this.startStudy());
        document.getElementById('add-btn').addEventListener('click', () => this.showAddCard());
        document.getElementById('browse-btn').addEventListener('click', () => this.showBrowser());
        document.getElementById('stats-btn').addEventListener('click', () => this.showStats());
        
        // Add deck button
        document.getElementById('add-deck-btn').addEventListener('click', () => this.addNewDeck());
        
        // Search
        document.getElementById('global-search').addEventListener('input', (e) => {
            this.searchCards(e.target.value);
        });
        
        // Modal close buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-close') || 
                e.target.closest('.modal-close')) {
                this.closeModal();
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.flipCard();
                    break;
                case '1':
                case '2':
                case '3':
                case '4':
                    if (this.isStudying && this.isFlipped) {
                        this.answerCard(parseInt(e.key));
                    }
                    break;
                case 'Escape':
                    if (this.isStudying) {
                        this.exitStudy();
                    }
                    break;
                case 'n':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.showAddCard();
                    }
                    break;
            }
        });
    }

    setupGestures() {
        // Swipe gestures for card answering
        let startX, startY;
        const threshold = 50;
        
        document.addEventListener('touchstart', (e) => {
            if (!this.isStudying) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            if (!this.isStudying || !this.isFlipped) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const diffX = endX - startX;
            const diffY = endY - startY;
            
            if (Math.abs(diffX) > Math.abs(diffY)) {
                // Horizontal swipe
                if (Math.abs(diffX) > threshold) {
                    if (diffX > 0) {
                        this.answerCard(4); // Easy (swipe right)
                    } else {
                        this.answerCard(1); // Again (swipe left)
                    }
                }
            } else {
                // Vertical swipe
                if (Math.abs(diffY) > threshold) {
                    if (diffY > 0) {
                        this.answerCard(2); // Hard (swipe down)
                    } else {
                        this.answerCard(3); // Good (swipe up)
                    }
                }
            }
        });
        
        // Tap to flip
        document.addEventListener('click', (e) => {
            if (this.isStudying && e.target.closest('.study-card')) {
                this.flipCard();
            }
        });
    }

    setupPWA() {
        // Check if running as PWA
        if (window.matchMedia('(display-mode: standalone)').matches) {
            document.body.classList.add('pwa-mode');
        }
        
        // Online/offline detection
        window.addEventListener('online', () => this.updateConnectionStatus(true));
        window.addEventListener('offline', () => this.updateConnectionStatus(false));
        
        // Prevent pull-to-refresh
        let startY;
        document.addEventListener('touchstart', (e) => {
            startY = e.touches[0].pageY;
        }, { passive: true });
        
        document.addEventListener('touchmove', (e) => {
            if (window.scrollY === 0 && e.touches[0].pageY > startY) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    updateConnectionStatus(online) {
        const syncStatus = document.querySelector('.sync-status');
        if (online) {
            syncStatus.innerHTML = '<i class="fas fa-check-circle"></i><span>Online</span>';
            syncStatus.style.color = '';
        } else {
            syncStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i><span>Offline</span>';
            syncStatus.style.color = 'var(--accent-orange)';
        }
    }

    selectDeck(deckId) {
        this.currentDeck = this.decks.find(d => d.id === deckId);
        
        // Update UI
        document.querySelectorAll('.deck-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.deck-item[data-deck-id="${deckId}"]`).classList.add('active');
        
        // Show deck overview
        this.showDeckOverview();
        this.updateStats();
    }

    showDeckOverview() {
        const content = document.getElementById('content-area');
        
        // Calculate deck stats
        const dueCount = this.calculateDueCount(this.currentDeck.id);
        const newCount = this.calculateNewCount(this.currentDeck.id);
        const totalCount = this.calculateTotalCount(this.currentDeck.id);
        
        content.innerHTML = `
            <div class="deck-overview-view ios-fade-in">
                <div class="deck-header">
                    <h2>${this.currentDeck.name}</h2>
                    ${this.currentDeck.desc ? `<p class="deck-description">${this.currentDeck.desc}</p>` : ''}
                </div>
                
                <div class="deck-stats-grid">
                    <div class="stat-card">
                        <h4>Due</h4>
                        <div class="stat-value">${dueCount}</div>
                    </div>
                    <div class="stat-card">
                        <h4>New</h4>
                        <div class="stat-value">${newCount}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Total</h4>
                        <div class="stat-value">${totalCount}</div>
                    </div>
                </div>
                
                <div class="deck-actions">
                    <button class="anki-toolbar-btn primary" onclick="app.startStudy()">
                        <i class="fas fa-play"></i>
                        <span>Study Now</span>
                    </button>
                    <button class="anki-toolbar-btn" onclick="app.showAddCard()">
                        <i class="fas fa-plus"></i>
                        <span>Add Cards</span>
                    </button>
                    <button class="anki-toolbar-btn" onclick="app.showDeckOptions()">
                        <i class="fas fa-cog"></i>
                        <span>Options</span>
                    </button>
                </div>
                
                ${dueCount === 0 ? `
                    <div class="anki-empty-state">
                        <div class="empty-icon">
                            <i class="fas fa-check-circle fa-3x"></i>
                        </div>
                        <h2>All Caught Up!</h2>
                        <p>No cards due for review in this deck.</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        this.currentView = 'deck-overview';
    }

    calculateDueCount(deckId) {
        // In real implementation, calculate from database
        return Math.floor(Math.random() * 50);
    }

    calculateNewCount(deckId) {
        return Math.floor(Math.random() * 20);
    }

    calculateTotalCount(deckId) {
        return Math.floor(Math.random() * 100) + 50;
    }

    async startStudy() {
        if (!this.currentDeck) {
            this.showAlert('Please select a deck first');
            return;
        }
        
        // Get due cards for this deck
        const dueCards = await this.getDueCards(this.currentDeck.id);
        
        if (dueCards.length === 0) {
            this.showAlert('No cards due for study!');
            return;
        }
        
        this.studyQueue = dueCards;
        this.studyIndex = 0;
        this.isStudying = true;
        this.isFlipped = false;
        
        this.showStudyModal();
    }

    async getDueCards(deckId) {
        // Get cards due for review
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('cards', 'readonly');
            const store = tx.objectStore('cards');
            const index = store.index('deckId');
            const request = index.getAll(deckId);
            
            request.onsuccess = () => {
                // Filter cards due today
                const today = Math.floor(Date.now() / 86400000);
                const dueCards = request.result.filter(card => {
                    return card.due <= today || card.type === 'new';
                });
                
                // Sort by priority
                dueCards.sort((a, b) => {
                    const priority = { 'learning': 0, 'relearning': 1, 'review': 2, 'new': 3 };
                    return (priority[a.type] || 4) - (priority[b.type] || 4);
                });
                
                resolve(dueCards.slice(0, 100)); // Limit to 100 cards
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    showStudyModal() {
        const modal = document.getElementById('study-modal');
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="anki-study-modal ios-slide-up">
                <div class="study-header">
                    <div class="study-deck-info">
                        <h3>${this.currentDeck.name}</h3>
                        <div class="study-progress">${this.studyIndex + 1}/${this.studyQueue.length}</div>
                    </div>
                    <button class="modal-close" onclick="app.exitStudy()">&times;</button>
                </div>
                
                <div class="study-content" id="study-content">
                    <!-- Card will be loaded here -->
                </div>
                
                <div class="study-controls" id="study-controls">
                    <!-- Controls will be loaded here -->
                </div>
            </div>
        `;
        
        this.showNextCard();
    }

    async showNextCard() {
        if (this.studyIndex >= this.studyQueue.length) {
            this.showStudyComplete();
            return;
        }
        
        this.currentCard = this.studyQueue[this.studyIndex];
        
        // Get note for this card
        const note = await this.getNote(this.currentCard.noteId);
        
        // Render card
        const content = document.getElementById('study-content');
        const controls = document.getElementById('study-controls');
        
        if (note.type === 'cloze') {
            const clozeData = this.parseCloze(note.fields.text);
            content.innerHTML = `
                <div class="study-card card-flip ${this.isFlipped ? 'flipped' : ''}" onclick="app.flipCard()">
                    <div class="card-flip-inner">
                        <div class="card-front">
                            <div class="card-content">
                                ${clozeData.question}
                            </div>
                            <div class="card-footer">
                                <span class="card-type">${this.getCardType(this.currentCard)}</span>
                                <span class="card-hint">Tap to reveal</span>
                            </div>
                        </div>
                        <div class="card-back">
                            <div class="card-content">
                                ${clozeData.answer}
                                ${note.fields.extra ? `<div class="extra-content">${note.fields.extra}</div>` : ''}
                            </div>
                            <div class="card-footer">
                                <span class="card-type">Answer</span>
                                <span class="card-hint">Select rating</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="study-card card-flip ${this.isFlipped ? 'flipped' : ''}" onclick="app.flipCard()">
                    <div class="card-flip-inner">
                        <div class="card-front">
                            <div class="card-content">
                                ${note.fields.front || 'No front content'}
                            </div>
                            <div class="card-footer">
                                <span class="card-type">${this.getCardType(this.currentCard)}</span>
                                <span class="card-hint">Tap to reveal</span>
                            </div>
                        </div>
                        <div class="card-back">
                            <div class="card-content">
                                ${note.fields.back || 'No back content'}
                            </div>
                            <div class="card-footer">
                                <span class="card-type">Answer</span>
                                <span class="card-hint">Select rating</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Show answer buttons if flipped
        if (this.isFlipped) {
            controls.innerHTML = `
                <div class="answer-buttons-grid">
                    <button class="ios-answer-btn ios-answer-btn-again" onclick="app.answerCard(1)">
                        Again
                        <span class="ios-answer-label">1</span>
                    </button>
                    <button class="ios-answer-btn ios-answer-btn-hard" onclick="app.answerCard(2)">
                        Hard
                        <span class="ios-answer-label">2</span>
                    </button>
                    <button class="ios-answer-btn ios-answer-btn-good" onclick="app.answerCard(3)">
                        Good
                        <span class="ios-answer-label">3</span>
                    </button>
                    <button class="ios-answer-btn ios-answer-btn-easy" onclick="app.answerCard(4)">
                        Easy
                        <span class="ios-answer-label">4</span>
                    </button>
                </div>
            `;
        } else {
            controls.innerHTML = `
                <div class="study-hint">
                    <p>Tap card to reveal answer</p>
                </div>
            `;
        }
        
        // Update progress
        document.querySelector('.study-progress').textContent = 
            `${this.studyIndex + 1}/${this.studyQueue.length}`;
    }

    flipCard() {
        this.isFlipped = !this.isFlipped;
        
        // Add haptic feedback on iOS
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
        
        // Add visual feedback
        document.querySelector('.study-card').classList.add('haptic-feedback');
        setTimeout(() => {
            document.querySelector('.study-card').classList.remove('haptic-feedback');
        }, 100);
        
        this.showNextCard();
    }

    answerCard(rating) {
        if (!this.currentCard) return;
        
        // Schedule next review
        this.scheduleCard(this.currentCard, rating);
        
        // Move to next card
        this.studyIndex++;
        if (this.studyIndex < this.studyQueue.length) {
            this.currentCard = this.studyQueue[this.studyIndex];
            this.isFlipped = false;
            this.showNextCard();
        } else {
            this.showStudyComplete();
        }
        
        // Update stats
        this.updateStats();
    }

    scheduleCard(card, rating) {
        // Simple scheduling logic (replace with full SM-2)
        const now = Date.now();
        const dayMs = 86400000;
        
        if (rating === 1) { // Again
            card.due = now + 60000; // 1 minute
            card.interval = 0;
        } else if (rating === 2) { // Hard
            card.due = now + (1 * dayMs);
            card.interval = 1;
        } else if (rating === 3) { // Good
            card.due = now + (3 * dayMs);
            card.interval = 3;
        } else if (rating === 4) { // Easy
            card.due = now + (7 * dayMs);
            card.interval = 7;
        }
        
        card.lastReview = now;
        card.reviews = (card.reviews || 0) + 1;
        
        // Save to database
        this.saveCard(card);
        
        return card;
    }

    showStudyComplete() {
        const content = document.getElementById('study-content');
        const controls = document.getElementById('study-controls');
        
        content.innerHTML = `
            <div class="study-complete">
                <div class="complete-icon">
                    <i class="fas fa-check-circle fa-4x"></i>
                </div>
                <h2>Study Complete!</h2>
                <p>You've reviewed all due cards for now.</p>
            </div>
        `;
        
        controls.innerHTML = `
            <div class="complete-actions">
                <button class="anki-toolbar-btn primary" onclick="app.exitStudy()">
                    Return to Decks
                </button>
                <button class="anki-toolbar-btn" onclick="app.startStudy()">
                    Study Again
                </button>
            </div>
        `;
    }

    exitStudy() {
        document.getElementById('study-modal').style.display = 'none';
        this.isStudying = false;
        this.showDeckOverview();
    }

    showAddCard() {
        const modal = document.getElementById('add-card-modal');
        modal.style.display = 'flex';
        
        modal.querySelector('.modal-body').innerHTML = `
            <div class="add-card-form">
                <div class="form-group">
                    <label class="form-label">Deck</label>
                    <select class="macos-select" id="add-card-deck">
                        ${this.decks.map(deck => 
                            `<option value="${deck.id}" ${deck.id === this.currentDeck?.id ? 'selected' : ''}>
                                ${deck.name}
                            </option>`
                        ).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <div class="note-type-tabs">
                        <button class="note-type-tab active" data-type="basic">Basic</button>
                        <button class="note-type-tab" data-type="cloze">Cloze</button>
                        <button class="note-type-tab" data-type="reversed">Basic (and reversed)</button>
                    </div>
                </div>
                
                <div class="form-fields" id="form-fields">
                    <!-- Fields loaded based on type -->
                </div>
                
                <div class="form-group">
                    <label class="form-label">Tags (space separated)</label>
                    <input type="text" class="macos-input" id="add-card-tags" placeholder="vocabulary science math">
                </div>
                
                <div class="form-actions">
                    <button class="macos-btn" onclick="app.closeModal()">Cancel</button>
                    <button class="macos-btn primary" onclick="app.saveNewCard()">Add</button>
                </div>
            </div>
        `;
        
        // Load initial fields
        this.loadNoteFields('basic');
        
        // Add tab switching
        modal.querySelectorAll('.note-type-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                modal.querySelectorAll('.note-type-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.loadNoteFields(e.target.dataset.type);
            });
        });
    }

    loadNoteFields(type) {
        const fieldsDiv = document.getElementById('form-fields');
        
        if (type === 'cloze') {
            fieldsDiv.innerHTML = `
                <div class="form-group">
                    <label class="form-label">Text</label>
                    <textarea class="macos-textarea" id="cloze-text" 
                              placeholder="Enter text with {{c1::hidden}} cloze deletions"></textarea>
                    <div class="form-hint">
                        <i class="fas fa-info-circle"></i>
                        Use {{c1::text}} for cloze deletions. Add hint: {{c1::text::hint}}
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Extra</label>
                    <textarea class="macos-textarea" id="cloze-extra" 
                              placeholder="Additional information (optional)"></textarea>
                </div>
            `;
        } else {
            fieldsDiv.innerHTML = `
                <div class="form-group">
                    <label class="form-label">Front</label>
                    <textarea class="macos-textarea" id="basic-front" 
                              placeholder="Enter question text"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Back</label>
                    <textarea class="macos-textarea" id="basic-back" 
                              placeholder="Enter answer text"></textarea>
                </div>
            `;
        }
    }

    async saveNewCard() {
        const deckId = document.getElementById('add-card-deck').value;
        const type = document.querySelector('.note-type-tab.active').dataset.type;
        const tags = document.getElementById('add-card-tags').value.split(' ').filter(t => t.trim());
        
        let note;
        if (type === 'cloze') {
            const text = document.getElementById('cloze-text').value;
            const extra = document.getElementById('cloze-extra').value;
            
            note = {
                id: 'note_' + Date.now(),
                type: 'cloze',
                deckId: deckId,
                fields: { text, extra },
                tags: tags,
                created: Date.now(),
                modified: Date.now()
            };
        } else {
            const front = document.getElementById('basic-front').value;
            const back = document.getElementById('basic-back').value;
            
            note = {
                id: 'note_' + Date.now(),
                type: 'basic',
                deckId: deckId,
                fields: { front, back },
                tags: tags,
                created: Date.now(),
                modified: Date.now()
            };
        }
        
        // Save note
        await this.saveNote(note);
        
        // Create card(s)
        await this.createCardsFromNote(note);
        
        this.showAlert('Card added successfully!');
        this.closeModal();
        this.updateStats();
    }

    async saveNote(note) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('notes', 'readwrite');
            const store = tx.objectStore('notes');
            const request = store.put(note);
            
            request.onsuccess = () => resolve(note);
            request.onerror = () => reject(request.error);
        });
    }

    async createCardsFromNote(note) {
        const cardId = 'card_' + Date.now();
        const card = {
            id: cardId,
            noteId: note.id,
            deckId: note.deckId,
            type: 'new',
            due: Date.now(),
            interval: 0,
            ease: 2.5,
            reviews: 0,
            lapses: 0,
            lastReview: 0,
            created: Date.now()
        };
        
        await this.saveCard(card);
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

    async getNote(noteId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('notes', 'readonly');
            const store = tx.objectStore('notes');
            const request = store.get(noteId);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    parseCloze(text) {
        // Simple cloze parsing
        const clozeRegex = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
        
        let question = text;
        let answer = text;
        let match;
        
        while ((match = clozeRegex.exec(text)) !== null) {
            const [full, num, content, hint] = match;
            question = question.replace(full, hint ? `[${hint}]` : '[...]');
            answer = answer.replace(full, `<span class="cloze-answer">${content}</span>`);
        }
        
        return { question, answer };
    }

    getCardType(card) {
        switch(card.type) {
            case 'new': return 'New';
            case 'learning': return 'Learning';
            case 'review': return 'Review';
            case 'relearning': return 'Relearning';
            default: return 'Card';
        }
    }

    showBrowser() {
        const content = document.getElementById('content-area');
        content.innerHTML = `
            <div class="browser-view ios-fade-in">
                <div class="browser-header">
                    <h2>Browse</h2>
                    <div class="browser-controls">
                        <div class="search-container">
                            <i class="fas fa-search"></i>
                            <input type="text" class="search-input" placeholder="Search cards...">
                        </div>
                        <button class="anki-toolbar-btn">
                            <i class="fas fa-filter"></i>
                            <span>Filter</span>
                        </button>
                    </div>
                </div>
                
                <div class="browser-table-container">
                    <table class="macos-table">
                        <thead>
                            <tr>
                                <th>Card</th>
                                <th>Deck</th>
                                <th>Due</th>
                                <th>Type</th>
                                <th>Ease</th>
                            </tr>
                        </thead>
                        <tbody id="browser-table-body">
                            <!-- Table rows will be populated -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        this.currentView = 'browser';
        this.loadBrowserData();
    }

    async loadBrowserData() {
        // Load cards for browser
        const cards = await this.getAllCards();
        const tbody = document.getElementById('browser-table-body');
        
        tbody.innerHTML = cards.map(card => `
            <tr>
                <td>${card.id.substring(0, 8)}...</td>
                <td>${this.getDeckName(card.deckId)}</td>
                <td>${this.formatDueDate(card.due)}</td>
                <td>${card.type}</td>
                <td>${card.ease ? card.ease.toFixed(2) : '2.50'}</td>
            </tr>
        `).join('');
    }

    async getAllCards() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('cards', 'readonly');
            const store = tx.objectStore('cards');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    getDeckName(deckId) {
        const deck = this.decks.find(d => d.id === deckId);
        return deck ? deck.name : 'Unknown';
    }

    formatDueDate(timestamp) {
        if (!timestamp) return 'Now';
        
        const now = Date.now();
        const diff = timestamp - now;
        
        if (diff <= 0) return 'Now';
        if (diff < 60000) return '< 1m';
        if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
        if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
        if (diff < 604800000) return `${Math.floor(diff/86400000)}d`;
        
        return new Date(timestamp).toLocaleDateString();
    }

    showStats() {
        const content = document.getElementById('content-area');
        content.innerHTML = `
            <div class="stats-view ios-fade-in">
                <h2>Statistics</h2>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h4>Total Cards</h4>
                        <div class="stat-value">${this.calculateTotalCount('all')}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Due Today</h4>
                        <div class="stat-value">${this.calculateDueCount('all')}</div>
                    </div>
                    <div class="stat-card">
                        <h4>New Today</h4>
                        <div class="stat-value">${this.calculateNewCount('all')}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Study Time</h4>
                        <div class="stat-value">0m</div>
                    </div>
                </div>
                
                <div class="charts-placeholder">
                    <p>Detailed statistics charts coming soon...</p>
                </div>
            </div>
        `;
        
        this.currentView = 'stats';
    }

    addNewDeck() {
        const name = prompt('Enter deck name:');
        if (name && name.trim()) {
            const deck = {
                id: 'deck_' + Date.now(),
                name: name.trim(),
                desc: '',
                created: Date.now(),
                modified: Date.now(),
                options: {
                    newPerDay: 20,
                    reviewPerDay: 200,
                    learningSteps: [1, 10],
                    graduatingInterval: 1,
                    easyInterval: 4
                }
            };
            
            this.saveDeck(deck);
            this.decks.push(deck);
            this.renderDecksList();
            this.selectDeck(deck.id);
        }
    }

    renderDecksList() {
        const decksList = document.getElementById('decks-list');
        decksList.innerHTML = this.decks.map(deck => `
            <div class="deck-item ${this.currentDeck?.id === deck.id ? 'active' : ''}" 
                 data-deck-id="${deck.id}">
                <div class="deck-name">${deck.name}</div>
                <div class="deck-counts">
                    <span class="deck-due">${this.calculateDueCount(deck.id)}</span>
                    <span class="deck-new">${this.calculateNewCount(deck.id)}</span>
                </div>
            </div>
        `).join('');
    }

    searchCards(query) {
        // Implement search functionality
        console.log('Searching for:', query);
    }

    updateStats() {
        if (!this.currentDeck) return;
        
        const dueCount = this.calculateDueCount(this.currentDeck.id);
        const newCount = this.calculateNewCount(this.currentDeck.id);
        const totalCount = this.calculateTotalCount(this.currentDeck.id);
        
        // Update sidebar
        document.getElementById('total-due').textContent = dueCount;
        document.getElementById('total-new').textContent = newCount;
        
        // Update status bar
        document.getElementById('status-cards').textContent = totalCount;
        document.getElementById('status-due').textContent = dueCount;
        document.getElementById('status-new').textContent = newCount;
        
        // Update deck items
        this.decks.forEach(deck => {
            const deckItem = document.querySelector(`.deck-item[data-deck-id="${deck.id}"]`);
            if (deckItem) {
                deckItem.querySelector('.deck-due').textContent = this.calculateDueCount(deck.id);
                deckItem.querySelector('.deck-new').textContent = this.calculateNewCount(deck.id);
            }
        });
    }

    updateUI() {
        this.renderDecksList();
        this.showDeckOverview();
        this.updateStats();
    }

    closeModal() {
        document.querySelectorAll('.anki-modal-overlay').forEach(modal => {
            modal.style.display = 'none';
        });
    }

    showAlert(message) {
        alert(message); // Replace with custom modal in production
    }

    showError(message) {
        console.error(message);
        this.showAlert('Error: ' + message);
    }
}

// Initialize app
window.app = new AnkiApp();

// Make available globally
window.addEventListener('load', () => {
    console.log('Anki PWA loaded successfully');
});
