// Main Anki Application
class AnkiApp {
    constructor() {
        this.core = null;
        this.currentView = 'decks';
        this.currentDeck = null;
        this.currentCard = null;
        this.studyQueue = [];
        this.studyIndex = 0;
        this.isFlipped = false;
        
        this.init();
    }

    async init() {
        try {
            await AnkiDB.init();
            this.core = await new AnkiCore().init();
            this.setupEventListeners();
            this.renderDecks();
            this.updateStats();
            this.setupPWA();
        } catch (error) {
            console.error('Failed to initialize Anki:', error);
            this.showError('Failed to initialize. Please refresh.');
        }
    }

    setupEventListeners() {
        // Toolbar buttons
        document.getElementById('btn-study').addEventListener('click', () => this.startStudy());
        document.getElementById('btn-add').addEventListener('click', () => this.showAddCard());
        document.getElementById('btn-browse').addEventListener('click', () => this.showBrowser());
        document.getElementById('btn-stats').addEventListener('click', () => this.showStats());
        document.getElementById('btn-sync').addEventListener('click', () => this.sync());
        
        // Deck selection
        document.addEventListener('click', (e) => {
            if (e.target.closest('.deck-item')) {
                const deckId = e.target.closest('.deck-item').dataset.deckId;
                this.selectDeck(deckId);
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
                    if (this.isFlipped && this.currentView === 'study') {
                        this.answerCard(parseInt(e.key));
                    }
                    break;
                case 'Escape':
                    if (this.currentView === 'study') {
                        this.exitStudy();
                    }
                    break;
                case 'n':
                    if (e.ctrlKey || e.metaKey) {
                        this.showAddCard();
                    }
                    break;
            }
        });
        
        // Swipe gestures for study
        this.setupSwipeGestures();
    }

    setupSwipeGestures() {
        let startX, startY;
        const threshold = 50;
        
        document.addEventListener('touchstart', (e) => {
            if (this.currentView !== 'study') return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            if (this.currentView !== 'study' || !this.isFlipped) return;
            
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

    setupPWA() {
        // Check if app is installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            console.log('Running as PWA');
        }
        
        // Handle online/offline status
        window.addEventListener('online', () => this.updateSyncStatus(true));
        window.addEventListener('offline', () => this.updateSyncStatus(false));
        
        // Prevent pull-to-refresh
        document.body.style.overscrollBehavior = 'none';
    }

    updateSyncStatus(online) {
        const syncEl = document.getElementById('status-sync');
        if (online) {
            syncEl.innerHTML = '<i class="fas fa-check-circle"></i> Online';
            syncEl.style.color = '#06d6a0';
        } else {
            syncEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Offline';
            syncEl.style.color = '#ff6b6b';
        }
    }

    async renderDecks() {
        const decksList = document.getElementById('decks-list');
        const decks = await AnkiDB.getDecks();
        
        decksList.innerHTML = decks.map(deck => `
            <div class="deck-item ${this.currentDeck?.id === deck.id ? 'active' : ''}" 
                 data-deck-id="${deck.id}">
                <div class="deck-name">${deck.name}</div>
                <div class="deck-counts">
                    <span class="deck-due">${this.getDeckDueCount(deck.id)}</span>
                    <span class="deck-new">${this.getDeckNewCount(deck.id)}</span>
                </div>
            </div>
        `).join('');
    }

    async getDeckDueCount(deckId) {
        const cards = await AnkiDB.getDueCards(deckId);
        return cards.filter(c => c.queue === 2 || c.queue === 3).length;
    }

    async getDeckNewCount(deckId) {
        const cards = await AnkiDB.getCards(deckId);
        return cards.filter(c => c.queue === 0).length;
    }

    async selectDeck(deckId) {
        const decks = await AnkiDB.getDecks();
        this.currentDeck = decks.find(d => d.id == deckId);
        
        // Update UI
        document.querySelectorAll('.deck-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.deck-item[data-deck-id="${deckId}"]`).classList.add('active');
        
        // Render deck overview
        this.renderDeckOverview();
    }

    renderDeckOverview() {
        const content = document.getElementById('content-area');
        content.innerHTML = `
            <div class="deck-overview">
                <h2>${this.currentDeck?.name || 'No Deck Selected'}</h2>
                <div class="deck-stats-grid">
                    <div class="stat-card">
                        <h4>Due</h4>
                        <div class="stat-value">${this.getDeckDueCount(this.currentDeck?.id)}</div>
                    </div>
                    <div class="stat-card">
                        <h4>New</h4>
                        <div class="stat-value">${this.getDeckNewCount(this.currentDeck?.id)}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Total</h4>
                        <div class="stat-value">${this.core?.cards.filter(c => c.did === this.currentDeck?.id).length || 0}</div>
                    </div>
                </div>
                
                <div class="deck-actions">
                    <button class="anki-button primary" onclick="ankiApp.startStudy()">
                        <i class="fas fa-play"></i> Study Now
                    </button>
                    <button class="anki-button" onclick="ankiApp.showAddCard()">
                        <i class="fas fa-plus"></i> Add Cards
                    </button>
                </div>
                
                <div class="recent-cards">
                    <h4>Recent Cards</h4>
                    <!-- Recent cards list -->
                </div>
            </div>
        `;
    }

    async startStudy() {
        if (!this.currentDeck) {
            this.showAlert('Please select a deck first');
            return;
        }
        
        const dueCards = await AnkiDB.getDueCards(this.currentDeck.id);
        if (dueCards.length === 0) {
            this.showAlert('No cards due for study!');
            return;
        }
        
        this.studyQueue = dueCards;
        this.studyIndex = 0;
        this.currentView = 'study';
        this.isFlipped = false;
        
        // Show study modal
        this.showStudyModal();
        this.showNextCard();
    }

    showStudyModal() {
        const modal = document.getElementById('study-modal');
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="study-window macos-window">
                <div class="study-header">
                    <div class="study-deck-name">${this.currentDeck.name}</div>
                    <div class="study-progress">${this.studyIndex + 1}/${this.studyQueue.length}</div>
                    <button class="modal-close" onclick="ankiApp.exitStudy()">&times;</button>
                </div>
                <div class="study-content" id="study-content">
                    <!-- Card will be rendered here -->
                </div>
                <div class="answer-buttons" id="answer-buttons" style="display: none;">
                    <button class="answer-btn answer-btn-again" onclick="ankiApp.answerCard(1)">
                        Again
                        <span class="answer-btn-label">Space/1</span>
                    </button>
                    <button class="answer-btn answer-btn-hard" onclick="ankiApp.answerCard(2)">
                        Hard
                        <span class="answer-btn-label">2</span>
                    </button>
                    <button class="answer-btn answer-btn-good" onclick="ankiApp.answerCard(3)">
                        Good
                        <span class="answer-btn-label">3</span>
                    </button>
                    <button class="answer-btn answer-btn-easy" onclick="ankiApp.answerCard(4)">
                        Easy
                        <span class="answer-btn-label">4</span>
                    </button>
                </div>
            </div>
        `;
    }

    async showNextCard() {
        if (this.studyIndex >= this.studyQueue.length) {
            this.showStudyComplete();
            return;
        }
        
        this.currentCard = this.studyQueue[this.studyIndex];
        this.isFlipped = false;
        
        // Get note for this card
        const note = await this.getNote(this.currentCard.nid);
        const model = await this.getModel(note.mid);
        
        // Render card
        const content = document.getElementById('study-content');
        const answerButtons = document.getElementById('answer-buttons');
        
        if (model.id === 3) { // Cloze
            const clozeData = this.core.parseCloze(note.fields[0]);
            content.innerHTML = `
                <div class="anki-card" onclick="ankiApp.flipCard()">
                    <div class="card-content">
                        ${this.isFlipped ? clozeData.answer : clozeData.question}
                    </div>
                    <div class="card-footer">
                        <div class="card-type">${this.core.scheduler.getCardType(this.currentCard)}</div>
                        <div class="card-info">Click card to flip</div>
                    </div>
                </div>
            `;
        } else {
            const template = model.tmpls[this.currentCard.ord];
            let question = template.qfmt;
            let answer = template.afmt;
            
            // Replace field placeholders
            model.flds.forEach((field, idx) => {
                const regex = new RegExp(`{{${field.name}}}`, 'g');
                question = question.replace(regex, note.fields[idx] || '');
                answer = answer.replace(regex, note.fields[idx] || '');
            });
            
            // Replace FrontSide
            answer = answer.replace(/{{FrontSide}}/g, question);
            
            content.innerHTML = `
                <div class="anki-card" onclick="ankiApp.flipCard()">
                    <div class="card-content">
                        ${this.isFlipped ? answer : question}
                    </div>
                    <div class="card-footer">
                        <div class="card-type">${this.core.scheduler.getCardType(this.currentCard)}</div>
                        <div class="card-info">${this.isFlipped ? 'Select answer' : 'Click card to flip'}</div>
                    </div>
                </div>
            `;
        }
        
        answerButtons.style.display = this.isFlipped ? 'grid' : 'none';
        
        // Update progress
        document.querySelector('.study-progress').textContent = 
            `${this.studyIndex + 1}/${this.studyQueue.length}`;
    }

    flipCard() {
        this.isFlipped = !this.isFlipped;
        this.showNextCard(); // Re-render with flipped state
        
        // Haptic feedback on iOS
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }

    async answerCard(ease) {
        if (!this.currentCard) return;
        
        // Schedule next review
        const scheduled = this.core.scheduler.answerCard(this.currentCard, ease);
        await AnkiDB.saveCard(scheduled);
        
        // Record review
        await this.recordReview(this.currentCard.id, ease);
        
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

    async recordReview(cardId, ease) {
        const review = {
            id: Date.now(),
            cid: cardId,
            usn: -1,
            ease: ease,
            ivl: 0,
            lastIvl: 0,
            factor: 0,
            time: 0,
            type: 0
        };
        
        const tx = AnkiDB.db.transaction('reviews', 'readwrite');
        const store = tx.objectStore('reviews');
        store.add(review);
    }

    showStudyComplete() {
        const content = document.getElementById('study-content');
        content.innerHTML = `
            <div class="study-complete">
                <i class="fas fa-check-circle fa-4x" style="color: #06d6a0;"></i>
                <h2>Study Complete!</h2>
                <p>All cards reviewed for now.</p>
                <button class="anki-button primary" onclick="ankiApp.exitStudy()">
                    Return to Decks
                </button>
            </div>
        `;
        document.getElementById('answer-buttons').style.display = 'none';
    }

    exitStudy() {
        document.getElementById('study-modal').style.display = 'none';
        this.currentView = 'decks';
        this.renderDecks();
        this.updateStats();
    }

    showAddCard() {
        const modal = document.getElementById('add-card-modal');
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="modal-content macos-window">
                <div class="modal-header">
                    <h3>Add Cards</h3>
                    <button class="modal-close" onclick="this.closest('.anki-modal').style.display='none'">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="add-card-form">
                        <div class="form-row">
                            <label class="form-label">Deck</label>
                            <select class="form-select" id="add-card-deck">
                                ${this.core.decks.map(d => 
                                    `<option value="${d.id}">${d.name}</option>`
                                ).join('')}
                            </select>
                        </div>
                        
                        <div class="note-type-selector">
                            <button class="note-type-btn active" data-type="basic">Basic</button>
                            <button class="note-type-btn" data-type="cloze">Cloze</button>
                            <button class="note-type-btn" data-type="basic-reversed">Basic (Reversed)</button>
                        </div>
                        
                        <div class="form-row" id="basic-fields">
                            <label class="form-label">Front</label>
                            <textarea class="form-textarea" id="front-field" 
                                      placeholder="Enter question text"></textarea>
                            
                            <label class="form-label">Back</label>
                            <textarea class="form-textarea" id="back-field" 
                                      placeholder="Enter answer text"></textarea>
                        </div>
                        
                        <div class="form-row" id="cloze-fields" style="display: none;">
                            <label class="form-label">Text</label>
                            <textarea class="form-textarea" id="cloze-field" 
                                      placeholder="Enter text with {{c1::hidden}} cloze deletions"></textarea>
                            <small>Use {{c1::text}} for cloze deletions. Add hint with {{c1::text::hint}}</small>
                            
                            <label class="form-label">Extra</label>
                            <textarea class="form-textarea" id="extra-field" 
                                      placeholder="Additional information (optional)"></textarea>
                        </div>
                        
                        <div class="form-row">
                            <label class="form-label">Tags (space separated)</label>
                            <input type="text" class="form-input" id="tags-field" 
                                   placeholder="tag1 tag2 tag3">
                        </div>
                        
                        <div class="form-actions">
                            <button class="anki-button" onclick="this.closest('.anki-modal').style.display='none'">
                                Cancel
                            </button>
                            <button class="anki-button primary" onclick="ankiApp.saveCard()">
                                Add Card
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add note type switching
        modal.querySelectorAll('.note-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                modal.querySelectorAll('.note-type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const type = e.target.dataset.type;
                document.getElementById('basic-fields').style.display = 
                    type === 'cloze' ? 'none' : 'block';
                document.getElementById('cloze-fields').style.display = 
                    type === 'cloze' ? 'block' : 'none';
            });
        });
    }

    async saveCard() {
        const deckId = document.getElementById('add-card-deck').value;
        const type = document.querySelector('.note-type-btn.active').dataset.type;
        
        let note;
        if (type === 'cloze') {
            const text = document.getElementById('cloze-field').value;
            const extra = document.getElementById('extra-field').value;
            
            note = {
                id: Date.now(),
                guid: this.generateGuid(),
                mid: 3, // Cloze model ID
                mod: Date.now(),
                usn: -1,
                tags: document.getElementById('tags-field').value.split(' ').filter(t => t),
                fields: [text, extra],
                flags: 0,
                data: ''
            };
        } else {
            const front = document.getElementById('front-field').value;
            const back = document.getElementById('back-field').value;
            
            note = {
                id: Date.now(),
                guid: this.generateGuid(),
                mid: type === 'basic-reversed' ? 2 : 1,
                mod: Date.now(),
                usn: -1,
                tags: document.getElementById('tags-field').value.split(' ').filter(t => t),
                fields: [front, back],
                flags: 0,
                data: ''
            };
        }
        
        note.did = deckId;
        
        try {
            await AnkiDB.saveNote(note);
            this.showAlert('Card added successfully!');
            document.getElementById('add-card-modal').style.display = 'none';
            
            // Clear form
            document.getElementById('front-field').value = '';
            document.getElementById('back-field').value = '';
            document.getElementById('cloze-field').value = '';
            document.getElementById('extra-field').value = '';
            document.getElementById('tags-field').value = '';
            
            // Update stats
            this.updateStats();
        } catch (error) {
            this.showAlert('Failed to add card: ' + error.message);
        }
    }

    generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async getNote(nid) {
        return new Promise((resolve, reject) => {
            const tx = AnkiDB.db.transaction('notes', 'readonly');
            const store = tx.objectStore('notes');
            const request = store.get(Number(nid));
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getModel(mid) {
        return new Promise((resolve, reject) => {
            const tx = AnkiDB.db.transaction('models', 'readonly');
            const store = tx.objectStore('models');
            const request = store.get(Number(mid));
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    showBrowser() {
        const content = document.getElementById('content-area');
        content.innerHTML = `
            <div class="browser-container">
                <div class="browser-toolbar">
                    <input type="text" class="search-input" placeholder="Search cards..." 
                           oninput="ankiApp.searchCards(this.value)">
                    <button class="anki-button small">Filter</button>
                    <button class="anki-button small">Tags</button>
                </div>
                <div class="browser-table-container">
                    <table class="browser-table">
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
                            <!-- Cards will be populated here -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        this.currentView = 'browser';
        this.renderBrowserTable();
    }

    async renderBrowserTable() {
        const cards = await AnkiDB.getCards();
        const tbody = document.getElementById('browser-table-body');
        
        tbody.innerHTML = cards.map(card => `
            <tr>
                <td>${card.id}</td>
                <td>${this.getDeckName(card.did)}</td>
                <td>${this.core?.scheduler.getNextDue(card) || 'Unknown'}</td>
                <td>${this.core?.scheduler.getCardType(card) || 'Unknown'}</td>
                <td>${card.factor ? (card.factor / 1000).toFixed(2) : '2.50'}</td>
            </tr>
        `).join('');
    }

    getDeckName(deckId) {
        const deck = this.core.decks.find(d => d.id === deckId);
        return deck ? deck.name : 'Unknown';
    }

    showStats() {
        const content = document.getElementById('content-area');
        content.innerHTML = `
            <div class="stats-container">
                <h2>Statistics</h2>
                <div class="stats-grid">
                    <div class="stat-box">
                        <h4>Reviews Today</h4>
                        <div class="stat-value-large">0</div>
                    </div>
                    <div class="stat-box">
                        <h4>Time Today</h4>
                        <div class="stat-value-large">0m</div>
                    </div>
                    <div class="stat-box">
                        <h4>Average Time</h4>
                        <div class="stat-value-large">0s</div>
                    </div>
                    <div class="stat-box">
                        <h4>Total Cards</h4>
                        <div class="stat-value-large">${this.core?.cards.length || 0}</div>
                    </div>
                </div>
            </div>
        `;
        
        this.currentView = 'stats';
    }

    async searchCards(query) {
        // Implement search functionality
        console.log('Searching for:', query);
    }

    async sync() {
        this.showAlert('Sync feature coming soon. Data is stored locally.');
    }

    updateStats() {
        if (!this.core) return;
        
        const totalCards = this.core.cards.length;
        const totalDue = this.core.cards.filter(c => c.queue === 2 || c.queue === 3).length;
        const totalNew = this.core.cards.filter(c => c.queue === 0).length;
        
        document.getElementById('total-due').textContent = totalDue;
        document.getElementById('total-new').textContent = totalNew;
        document.getElementById('status-cards').textContent = totalCards;
        document.getElementById('status-due').textContent = totalDue;
        document.getElementById('status-new').textContent = totalNew;
    }

    showAlert(message) {
        alert(message); // In production, use a custom modal
    }

    showError(message) {
        console.error(message);
        this.showAlert('Error: ' + message);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.ankiApp = new AnkiApp();
});
