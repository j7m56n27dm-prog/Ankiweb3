// UI Controller for Anki

class AnkiUIController {
    constructor() {
        this.engine = window.AnkiEngine;
        this.db = window.AnkiDB;
        this.scheduler = window.AnkiScheduler;
        
        this.currentView = 'deck-overview';
        this.currentDeck = null;
        this.isStudying = false;
        
        // Bind methods
        this.init = this.init.bind(this);
        this.renderDecks = this.renderDecks.bind(this);
        this.showDeckOverview = this.showDeckOverview.bind(this);
        this.showAddCard = this.showAddCard.bind(this);
        this.showBrowse = this.showBrowse.bind(this);
        this.showStats = this.showStats.bind(this);
        this.startStudy = this.startStudy.bind(this);
        this.flipCard = this.flipCard.bind(this);
        this.answerCard = this.answerCard.bind(this);
        this.closeStudy = this.closeStudy.bind(this);
    }

    async init() {
        try {
            // Initialize engine
            const success = await this.engine.init();
            if (!success) {
                throw new Error('Failed to initialize engine');
            }
            
            // Load decks
            await this.loadDecks();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Show initial view
            await this.showDeckOverview();
            
            // Hide loading screen
            document.body.classList.add('app-loaded');
            
            console.log('UI Controller initialized');
        } catch (error) {
            console.error('Failed to initialize UI:', error);
            this.showError('Failed to initialize application. Please refresh.');
        }
    }

    async loadDecks() {
        const decks = await this.engine.getDecks();
        this.decks = decks;
        
        if (decks.length > 0 && !this.currentDeck) {
            this.currentDeck = decks[0];
        }
        
        await this.renderDecks();
        await this.updateStats();
    }

    async renderDecks() {
        const decksList = document.getElementById('decks-list');
        if (!decksList) return;
        
        let html = '';
        
        for (const deck of this.decks) {
            const stats = await this.engine.getDeckStats(deck.id);
            const isActive = this.currentDeck && this.currentDeck.id === deck.id;
            
            html += `
                <div class="deck-item ${isActive ? 'active' : ''}" 
                     data-deck-id="${deck.id}">
                    <div class="deck-name">${deck.name}</div>
                    <div class="deck-stats">
                        <span class="deck-due">${stats.due}</span>
                        <span class="deck-new">${stats.new}</span>
                    </div>
                </div>
            `;
        }
        
        decksList.innerHTML = html;
        
        // Update total stats
        const totalStats = await this.engine.getStats();
        document.getElementById('total-due').textContent = totalStats.totalDue;
        document.getElementById('total-new').textContent = totalStats.totalNew;
    }

    async showDeckOverview() {
        this.switchView('deck-overview');
        
        const content = document.getElementById('deck-overview');
        if (!content) return;
        
        if (!this.currentDeck) {
            content.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-cards fa-3x"></i>
                    <h2>No Decks</h2>
                    <p>Create a deck to get started</p>
                    <button class="anki-btn primary" id="create-first-deck">
                        <i class="fas fa-plus"></i>
                        Create First Deck
                    </button>
                </div>
            `;
            
            document.getElementById('create-first-deck')?.addEventListener('click', () => {
                this.createNewDeck();
            });
            
            return;
        }
        
        const stats = await this.engine.getDeckStats(this.currentDeck.id);
        
        content.innerHTML = `
            <div class="deck-details fade-in">
                <div class="deck-header">
                    <h2>${this.currentDeck.name}</h2>
                    ${this.currentDeck.desc ? `<p class="deck-description">${this.currentDeck.desc}</p>` : ''}
                </div>
                
                <div class="deck-stats-grid">
                    <div class="stat-card">
                        <h4>Due</h4>
                        <div class="stat-value">${stats.due}</div>
                    </div>
                    <div class="stat-card">
                        <h4>New</h4>
                        <div class="stat-value">${stats.new}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Total</h4>
                        <div class="stat-value">${stats.total}</div>
                    </div>
                </div>
                
                <div class="deck-actions">
                    <button class="anki-btn primary" id="start-study-btn">
                        <i class="fas fa-play"></i>
                        <span>Study Now</span>
                    </button>
                    <button class="anki-btn" id="add-cards-btn">
                        <i class="fas fa-plus"></i>
                        <span>Add Cards</span>
                    </button>
                    <button class="anki-btn" id="deck-options-btn">
                        <i class="fas fa-cog"></i>
                        <span>Options</span>
                    </button>
                </div>
                
                ${stats.due === 0 ? `
                    <div class="empty-state">
                        <i class="fas fa-check-circle fa-3x"></i>
                        <h2>All Caught Up!</h2>
                        <p>No cards due for review in this deck.</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        // Add event listeners
        document.getElementById('start-study-btn')?.addEventListener('click', () => this.startStudy());
        document.getElementById('add-cards-btn')?.addEventListener('click', () => this.showAddCard());
        document.getElementById('deck-options-btn')?.addEventListener('click', () => this.showDeckOptions());
    }

    async showAddCard() {
        this.switchView('add-card');
        
        const content = document.getElementById('add-card-view');
        if (!content) return;
        
        if (!this.currentDeck) {
            content.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle fa-3x"></i>
                    <h2>No Deck Selected</h2>
                    <p>Please select a deck first</p>
                </div>
            `;
            return;
        }
        
        const models = await this.db.getModels();
        
        content.innerHTML = `
            <div class="add-card-container slide-up">
                <div class="form-group">
                    <label class="form-label">Deck</label>
                    <select class="form-select" id="card-deck-select">
                        ${this.decks.map(deck => `
                            <option value="${deck.id}" ${deck.id === this.currentDeck.id ? 'selected' : ''}>
                                ${deck.name}
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Note Type</label>
                    <div class="note-type-selector">
                        ${models.map(model => `
                            <button class="note-type-btn ${model.id === 'basic' ? 'active' : ''}" 
                                    data-type="${model.id}">
                                ${model.name}
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <div class="form-fields" id="form-fields">
                    <!-- Fields will be loaded based on type -->
                </div>
                
                <div class="form-group">
                    <label class="form-label">Tags (space separated)</label>
                    <input type="text" class="form-input" id="card-tags" 
                           placeholder="vocabulary science math">
                </div>
                
                <div class="form-actions">
                    <button class="anki-btn" id="cancel-add-card">
                        Cancel
                    </button>
                    <button class="anki-btn primary" id="save-card-btn">
                        <i class="fas fa-save"></i>
                        Add Card
                    </button>
                </div>
            </div>
        `;
        
        // Load initial fields
        await this.loadNoteFields('basic');
        
        // Add event listeners
        document.getElementById('card-deck-select').addEventListener('change', (e) => {
            this.currentDeck = this.decks.find(d => d.id === e.target.value);
        });
        
        document.querySelectorAll('.note-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.note-type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.loadNoteFields(e.target.dataset.type);
            });
        });
        
        document.getElementById('cancel-add-card').addEventListener('click', () => {
            this.showDeckOverview();
        });
        
        document.getElementById('save-card-btn').addEventListener('click', () => {
            this.saveNewCard();
        });
    }

    async loadNoteFields(type) {
        const fieldsDiv = document.getElementById('form-fields');
        const models = await this.db.getModels();
        const model = models.find(m => m.id === type);
        
        if (!model) return;
        
        let fieldsHTML = '';
        
        if (type === 'cloze') {
            fieldsHTML = `
                <div class="form-group">
                    <label class="form-label">Text</label>
                    <textarea class="form-textarea" id="cloze-text" 
                              placeholder="Enter text with {{c1::hidden}} cloze deletions" 
                              rows="6"></textarea>
                    <div class="form-hint">
                        <i class="fas fa-info-circle"></i>
                        Use {{c1::text}} for cloze deletions. Add hint: {{c1::text::hint}}
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Extra</label>
                    <textarea class="form-textarea" id="cloze-extra" 
                              placeholder="Additional information (optional)" 
                              rows="3"></textarea>
                </div>
            `;
        } else {
            model.fields.forEach((field, index) => {
                fieldsHTML += `
                    <div class="form-group">
                        <label class="form-label">${field}</label>
                        <textarea class="form-textarea" id="field-${index}" 
                                  placeholder="Enter ${field.toLowerCase()} text" 
                                  rows="4"></textarea>
                    </div>
                `;
            });
        }
        
        fieldsDiv.innerHTML = fieldsHTML;
    }

    async saveNewCard() {
        const deckId = document.getElementById('card-deck-select').value;
        const type = document.querySelector('.note-type-btn.active').dataset.type;
        const tags = document.getElementById('card-tags').value.split(' ').filter(t => t.trim());
        
        let fields = {};
        const models = await this.db.getModels();
        const model = models.find(m => m.id === type);
        
        if (!model) {
            this.showError('Invalid note type');
            return;
        }
        
        if (type === 'cloze') {
            fields = {
                Text: document.getElementById('cloze-text').value,
                Extra: document.getElementById('cloze-extra').value
            };
        } else {
            model.fields.forEach((field, index) => {
                fields[field] = document.getElementById(`field-${index}`).value;
            });
        }
        
        // Validate
        if (type === 'cloze' && !fields.Text.trim()) {
            this.showError('Cloze text is required');
            return;
        }
        
        if (type !== 'cloze' && (!fields[model.fields[0]] || !fields[model.fields[0]].trim())) {
            this.showError(`${model.fields[0]} is required`);
            return;
        }
        
        try {
            await this.engine.addNote(deckId, type, fields, tags);
            
            // Clear form
            if (type === 'cloze') {
                document.getElementById('cloze-text').value = '';
                document.getElementById('cloze-extra').value = '';
            } else {
                model.fields.forEach((field, index) => {
                    document.getElementById(`field-${index}`).value = '';
                });
            }
            document.getElementById('card-tags').value = '';
            
            // Show success message
            this.showMessage('Card added successfully!');
            
            // Update stats
            await this.updateStats();
            
            // Return to deck overview
            this.showDeckOverview();
        } catch (error) {
            console.error('Failed to save card:', error);
            this.showError('Failed to save card: ' + error.message);
        }
    }

    async showBrowse() {
        this.switchView('browse');
        
        const content = document.getElementById('browse-view');
        if (!content) return;
        
        content.innerHTML = `
            <div class="browse-container fade-in">
                <div class="browse-header">
                    <h2>Browse Cards</h2>
                    <div class="browse-controls">
                        <div class="search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="browse-search" placeholder="Search cards...">
                        </div>
                        <button class="anki-btn" id="browse-filter-btn">
                            <i class="fas fa-filter"></i>
                            <span>Filter</span>
                        </button>
                    </div>
                </div>
                
                <div class="browse-table-container">
                    <table class="browse-table">
                        <thead>
                            <tr>
                                <th>Card</th>
                                <th>Deck</th>
                                <th>Due</th>
                                <th>Type</th>
                                <th>Ease</th>
                            </tr>
                        </thead>
                        <tbody id="browse-table-body">
                            <!-- Cards will be loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        // Load initial data
        await this.loadBrowseData();
        
        // Add event listeners
        document.getElementById('browse-search').addEventListener('input', (e) => {
            this.searchBrowseCards(e.target.value);
        });
    }

    async loadBrowseData(searchQuery = '') {
        const tbody = document.getElementById('browse-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
        
        try {
            const cards = await this.engine.searchCards(searchQuery, this.currentDeck?.id);
            
            if (cards.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center">
                            <div class="empty-state-small">
                                <i class="fas fa-search"></i>
                                <p>No cards found</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            
            for (const card of cards.slice(0, 50)) {
                const note = await this.db.getNote(card.noteId);
                const deck = this.decks.find(d => d.id === card.deckId);
                
                html += `
                    <tr>
                        <td>${this.truncateText(this.getCardPreview(note), 50)}</td>
                        <td>${deck ? deck.name : 'Unknown'}</td>
                        <td>${this.scheduler.getNextDue(card)}</td>
                        <td>${this.scheduler.getCardType(card)}</td>
                        <td>${card.ease ? card.ease.toFixed(2) : '2.50'}</td>
                    </tr>
                `;
            }
            
            tbody.innerHTML = html;
        } catch (error) {
            console.error('Failed to load browse data:', error);
            tbody.innerHTML = '<tr><td colspan="5" class="text-center error">Failed to load cards</td></tr>';
        }
    }

    getCardPreview(note) {
        if (!note || !note.fields) return '';
        
        if (note.model === 'cloze') {
            return note.fields.Text || '';
        } else {
            return note.fields.Front || note.fields[Object.keys(note.fields)[0]] || '';
        }
    }

    truncateText(text, length) {
        if (!text) return '';
        if (text.length <= length) return text;
        return text.substring(0, length) + '...';
    }

    async searchBrowseCards(query) {
        await this.loadBrowseData(query);
    }

    async showStats() {
        this.switchView('stats');
        
        const content = document.getElementById('stats-view');
        if (!content) return;
        
        const stats = await this.engine.getStats();
        
        content.innerHTML = `
            <div class="stats-container fade-in">
                <h2>Statistics</h2>
                
                <div class="stats-summary">
                    <div class="stat-card-large">
                        <h4>Total Cards</h4>
                        <div class="stat-value-large">${stats.totalCards}</div>
                    </div>
                    <div class="stat-card-large">
                        <h4>Due Today</h4>
                        <div class="stat-value-large">${stats.totalDue}</div>
                    </div>
                    <div class="stat-card-large">
                        <h4>Decks</h4>
                        <div class="stat-value-large">${stats.deckCount}</div>
                    </div>
                </div>
                
                <div class="stats-breakdown">
                    <h3>Breakdown</h3>
                    <div class="breakdown-grid">
                        <div class="breakdown-item">
                            <span class="breakdown-label">New Cards</span>
                            <span class="breakdown-value">${stats.totalNew}</span>
                        </div>
                        <div class="breakdown-item">
                            <span class="breakdown-label">Learning</span>
                            <span class="breakdown-value">${stats.totalLearning}</span>
                        </div>
                        <div class="breakdown-item">
                            <span class="breakdown-label">Review</span>
                            <span class="breakdown-value">${stats.totalReview}</span>
                        </div>
                    </div>
                </div>
                
                <div class="stats-charts">
                    <h3>Study Activity</h3>
                    <div class="chart-placeholder">
                        <p>Detailed charts coming soon...</p>
                    </div>
                </div>
            </div>
        `;
    }

    async startStudy() {
        if (!this.currentDeck) {
            this.showError('Please select a deck first');
            return;
        }
        
        try {
            const cardContent = await this.engine.startStudySession(this.currentDeck.id);
            
            if (!cardContent) {
                this.showMessage('No cards due for study!');
                return;
            }
            
            this.isStudying = true;
            this.showStudyModal(cardContent);
        } catch (error) {
            console.error('Failed to start study:', error);
            this.showError('Failed to start study session');
        }
    }

    showStudyModal(cardContent) {
        const modal = document.getElementById('study-modal');
        modal.classList.add('active');
        
        document.getElementById('study-deck-name').textContent = this.currentDeck.name;
        document.getElementById('study-progress').textContent = '1/??';
        
        this.updateStudyCard(cardContent);
    }

    updateStudyCard(cardContent) {
        const studyContent = document.getElementById('study-content');
        const studyControls = document.getElementById('study-controls');
        
        if (!cardContent) {
            // Study complete
            studyContent.innerHTML = `
                <div class="study-complete">
                    <div class="complete-icon">
                        <i class="fas fa-check-circle fa-4x"></i>
                    </div>
                    <h2>Study Complete!</h2>
                    <p>You've reviewed all due cards for now.</p>
                </div>
            `;
            
            studyControls.innerHTML = `
                <div class="study-complete-actions">
                    <button class="anki-btn primary" id="return-to-decks">
                        Return to Decks
                    </button>
                </div>
            `;
            
            document.getElementById('return-to-decks').addEventListener('click', () => {
                this.closeStudy();
            });
            
            return;
        }
        
        // Update progress
        const progress = `${this.engine.studyIndex + 1}/${this.engine.studyQueue.length}`;
        document.getElementById('study-progress').textContent = progress;
        
        // Show card
        studyContent.innerHTML = `
            <div class="study-card ${this.engine.isFlipped ? 'flipped' : ''}" id="current-study-card">
                <div class="card-content">
                    ${this.engine.isFlipped ? cardContent.answer : cardContent.question}
                </div>
                <div class="card-footer">
                    <span class="card-type">${cardContent.type}</span>
                    <span class="card-hint">${this.engine.isFlipped ? 'Select rating' : 'Tap to flip'}</span>
                </div>
            </div>
        `;
        
        // Show answer buttons if flipped
        if (this.engine.isFlipped) {
            studyControls.innerHTML = `
                <div class="answer-buttons-grid">
                    <button class="answer-btn answer-btn-again" data-rating="1">
                        Again
                        <span class="answer-label">1</span>
                    </button>
                    <button class="answer-btn answer-btn-hard" data-rating="2">
                        Hard
                        <span class="answer-label">2</span>
                    </button>
                    <button class="answer-btn answer-btn-good" data-rating="3">
                        Good
                        <span class="answer-label">3</span>
                    </button>
                    <button class="answer-btn answer-btn-easy" data-rating="4">
                        Easy
                        <span class="answer-label">4</span>
                    </button>
                </div>
            `;
            
            // Add event listeners to answer buttons
            document.querySelectorAll('.answer-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const rating = parseInt(e.currentTarget.dataset.rating);
                    this.answerCard(rating);
                });
            });
        } else {
            studyControls.innerHTML = `
                <div class="study-hint">
                    <p>Tap card to reveal answer</p>
                </div>
            `;
        }
        
        // Add click event to card for flipping
        document.getElementById('current-study-card').addEventListener('click', () => {
            this.flipCard();
        });
    }

    async flipCard() {
        this.engine.isFlipped = !this.engine.isFlipped;
        
        // Get current card content again
        const cardContent = await this.engine.getCardContent(this.engine.currentCard);
        this.updateStudyCard(cardContent);
        
        // Haptic feedback on iOS
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }

    async answerCard(rating) {
        try {
            const nextCard = await this.engine.answerCurrentCard(rating);
            
            // Add swipe animation
            const studyCard = document.getElementById('current-study-card');
            if (studyCard) {
                studyCard.classList.add('swipe-left');
                setTimeout(() => {
                    studyCard.classList.remove('swipe-left');
                    this.updateStudyCard(nextCard);
                }, 300);
            } else {
                this.updateStudyCard(nextCard);
            }
            
            // Update deck stats
            await this.updateStats();
        } catch (error) {
            console.error('Failed to answer card:', error);
            this.showError('Failed to process answer');
        }
    }

    closeStudy() {
        const modal = document.getElementById('study-modal');
        modal.classList.remove('active');
        
        this.isStudying = false;
        this.engine.isFlipped = false;
        
        // Refresh deck overview
        this.showDeckOverview();
    }

    async createNewDeck() {
        const name = prompt('Enter deck name:');
        if (!name || !name.trim()) return;
        
        try {
            const deck = await this.engine.createDeck(name.trim());
            this.currentDeck = deck;
            await this.loadDecks();
            await this.showDeckOverview();
            this.showMessage('Deck created successfully!');
        } catch (error) {
            console.error('Failed to create deck:', error);
            this.showError('Failed to create deck');
        }
    }

    async showDeckOptions() {
        // For now, just show a simple message
        this.showMessage('Deck options feature coming soon!');
    }

    async updateStats() {
        if (!this.currentDeck) return;
        
        try {
            const deckStats = await this.engine.getDeckStats(this.currentDeck.id);
            const totalStats = await this.engine.getStats();
            
            // Update status bar
            document.getElementById('status-cards').textContent = totalStats.totalCards;
            document.getElementById('status-due').textContent = totalStats.totalDue;
            document.getElementById('status-new').textContent = totalStats.totalNew;
            
            // Update deck list
            await this.renderDecks();
        } catch (error) {
            console.error('Failed to update stats:', error);
        }
    }

    switchView(viewName) {
        this.currentView = viewName;
        
        // Hide all views
        document.querySelectorAll('.content-pane > div').forEach(view => {
            view.classList.remove('active');
        });
        
        // Show selected view
        const viewElement = document.getElementById(`${viewName}-view`) || 
                           document.getElementById(viewName);
        if (viewElement) {
            viewElement.classList.add('active');
        }
        
        // Update active toolbar button
        document.querySelectorAll('.anki-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`[data-view="${viewName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    setupEventListeners() {
        // Deck selection
        document.addEventListener('click', (e) => {
            const deckItem = e.target.closest('.deck-item');
            if (deckItem) {
                const deckId = deckItem.dataset.deckId;
                const deck = this.decks.find(d => d.id === deckId);
                if (deck) {
                    this.currentDeck = deck;
                    this.showDeckOverview();
                }
            }
        });
        
        // Toolbar buttons
        document.getElementById('study-btn').addEventListener('click', () => this.startStudy());
        document.getElementById('add-btn').addEventListener('click', () => this.showAddCard());
        document.getElementById('browse-btn').addEventListener('click', () => this.showBrowse());
        document.getElementById('stats-btn').addEventListener('click', () => this.showStats());
        
        // Add deck button
        document.getElementById('add-deck-btn').addEventListener('click', () => this.createNewDeck());
        
        // Sync button
        document.getElementById('sync-btn').addEventListener('click', () => {
            this.showMessage('Sync feature coming soon!');
        });
        
        // Close study modal
        document.getElementById('close-study').addEventListener('click', () => this.closeStudy());
        
        // Global search
        document.getElementById('global-search').addEventListener('input', (e) => {
            this.searchGlobal(e.target.value);
        });
        
        // Connection status
        window.addEventListener('online', () => this.updateConnectionStatus(true));
        window.addEventListener('offline', () => this.updateConnectionStatus(false));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            if (this.isStudying) {
                switch(e.key) {
                    case ' ':
                        e.preventDefault();
                        this.flipCard();
                        break;
                    case '1':
                    case '2':
                    case '3':
                    case '4':
                        if (this.engine.isFlipped) {
                            this.answerCard(parseInt(e.key));
                        }
                        break;
                    case 'Escape':
                        this.closeStudy();
                        break;
                }
            }
        });
        
        // Swipe gestures for study
        this.setupSwipeGestures();
    }

    setupSwipeGestures() {
        let startX, startY;
        const threshold = 50;
        
        document.addEventListener('touchstart', (e) => {
            if (!this.isStudying || !this.engine.isFlipped) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            if (!this.isStudying || !this.engine.isFlipped) return;
            
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
    }

    async searchGlobal(query) {
        // For now, just log the search
        console.log('Global search:', query);
        // In a full implementation, you might want to show search results
    }

    updateConnectionStatus(online) {
        const statusElement = document.getElementById('connection-status');
        if (!statusElement) return;
        
        if (online) {
            statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Online</span>';
            statusElement.style.color = '';
        } else {
            statusElement.innerHTML = '<i class="fas fa-wifi-slash"></i><span>Offline</span>';
            statusElement.style.color = 'var(--accent-orange)';
        }
    }

    showMessage(message) {
        alert(message); // Replace with custom toast in production
        console.log('Message:', message);
    }

    showError(message) {
        console.error('Error:', message);
        alert('Error: ' + message); // Replace with custom error modal in production
    }
}

// Export UI controller
window.AnkiUI = new AnkiUIController();
