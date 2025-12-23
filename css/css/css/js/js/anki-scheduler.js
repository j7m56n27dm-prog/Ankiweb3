// Anki Scheduler (SM-2 Algorithm)
class AnkiScheduler {
    constructor() {
        // Default options matching Anki
        this.options = {
            learningSteps: [1, 10], // in minutes
            graduatingInterval: 1, // in days
            easyInterval: 4, // in days
            initialEase: 2.5,
            easyBonus: 1.3,
            intervalModifier: 1.0,
            hardInterval: 1.2,
            newCardsPerDay: 20,
            reviewsPerDay: 200,
            maximumInterval: 36500,
            minimumEase: 1.3,
            lapseEasePenalty: 0.8,
            lapseSteps: [10], // in minutes
            leechThreshold: 8,
            leechAction: 1 // 0=suspend, 1=tag only
        };
    }

    // Answer types: 1=Again, 2=Hard, 3=Good, 4=Easy
    answerCard(card, ease) {
        const now = Math.floor(Date.now() / 1000);
        
        // Convert Anki's queue types
        // 0 = new, 1 = learning, 2 = review, 3 = relearning
        if (card.queue === 0) {
            // New card
            return this._answerNewCard(card, ease, now);
        } else if (card.queue === 1 || card.queue === 3) {
            // Learning or relearning
            return this._answerLearningCard(card, ease, now);
        } else if (card.queue === 2) {
            // Review card
            return this._answerReviewCard(card, ease, now);
        }
        
        return card;
    }

    _answerNewCard(card, ease, now) {
        if (ease === 1) {
            // Again - back to learning
            card.queue = 1;
            card.left = this._leftSteps(1, 0);
            card.due = now + (this.options.learningSteps[0] * 60);
        } else {
            // Good or Easy - graduated
            card.queue = 2;
            card.ivl = ease === 4 ? this.options.easyInterval : this.options.graduatingInterval;
            card.due = now + (card.ivl * 86400);
            card.ease = this.options.initialEase;
            card.factor = Math.round(card.ease * 1000);
        }
        
        card.type = 2; // graduated to review
        card.reps = (card.reps || 0) + 1;
        card.mod = now;
        
        return card;
    }

    _answerLearningCard(card, ease, now) {
        if (ease === 1) {
            // Again - reset learning steps
            card.left = this._leftSteps(1, 0);
            card.due = now + (this.options.learningSteps[0] * 60);
        } else {
            // Advance in learning steps
            const remaining = this._remainingSteps(card.left);
            if (remaining > 1) {
                // Still more steps
                card.left = this._leftSteps(remaining - 1, card.left);
                const stepIdx = this.options.learningSteps.length - remaining;
                card.due = now + (this.options.learningSteps[stepIdx] * 60);
            } else {
                // Finished learning steps
                if (card.queue === 3) {
                    // Was in relearning, back to review
                    card.queue = 2;
                    card.ivl = Math.max(1, Math.floor(card.ivl * this.options.lapseEasePenalty));
                } else {
                    // Graduated from learning
                    card.queue = 2;
                    card.ivl = ease === 4 ? this.options.easyInterval : this.options.graduatingInterval;
                    card.ease = this.options.initialEase;
                    card.factor = Math.round(card.ease * 1000);
                }
                card.due = now + (card.ivl * 86400);
            }
        }
        
        card.reps = (card.reps || 0) + 1;
        card.mod = now;
        
        return card;
    }

    _answerReviewCard(card, ease, now) {
        if (ease === 1) {
            // Again - lapse
            card.queue = 3; // relearning
            card.left = this._leftSteps(this.options.lapseSteps.length, 0);
            card.due = now + (this.options.lapseSteps[0] * 60);
            card.lapses = (card.lapses || 0) + 1;
            
            // Check for leech
            if (card.lapses >= this.options.leechThreshold) {
                this._handleLeech(card);
            }
        } else {
            // Update interval
            let easeFactor = (card.factor || 2500) / 1000;
            
            // Adjust ease based on answer
            if (ease === 2) {
                easeFactor = Math.max(this.options.minimumEase, easeFactor - 0.15);
            } else if (ease === 4) {
                easeFactor += 0.15;
            }
            
            card.factor = Math.round(easeFactor * 1000);
            
            // Calculate interval
            let interval;
            if (card.ivl === 0) {
                interval = 1;
            } else if (ease === 2) {
                interval = Math.max(1, Math.floor(card.ivl * this.options.hardInterval));
            } else if (ease === 3) {
                interval = Math.max(1, Math.floor(card.ivl * easeFactor * this.options.intervalModifier));
            } else if (ease === 4) {
                interval = Math.max(1, Math.floor(card.ivl * easeFactor * this.options.intervalModifier * this.options.easyBonus));
            }
            
            interval = Math.min(interval, this.options.maximumInterval);
            card.ivl = interval;
            card.due = now + (interval * 86400);
        }
        
        card.reps = (card.reps || 0) + 1;
        card.mod = now;
        
        return card;
    }

    _leftSteps(remaining, currentLeft) {
        // Anki's left calculation: 1000 + steps remaining
        // steps: 3 steps = 1003, 2 steps = 1002, 1 step = 1001, finished = 0
        if (remaining <= 0) return 0;
        return 1000 + remaining;
    }

    _remainingSteps(left) {
        if (left === 0) return 0;
        return left - 1000;
    }

    _handleLeech(card) {
        if (this.options.leechAction === 0) {
            card.queue = -1; // suspended
        }
        // In real Anki, would add leech tag
    }

    // Calculate next due date for display
    getNextDue(card) {
        if (!card.due) return 'Now';
        
        const now = Math.floor(Date.now() / 1000);
        const diff = card.due - now;
        
        if (diff <= 0) return 'Now';
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff/60)}m`;
        if (diff < 86400) return `${Math.floor(diff/3600)}h`;
        if (diff < 2592000) return `${Math.floor(diff/86400)}d`;
        
        const months = Math.floor(diff/2592000);
        return months >= 12 ? `${Math.floor(months/12)}y` : `${months}mo`;
    }

    // Get card type name
    getCardType(card) {
        switch(card.queue) {
            case 0: return 'New';
            case 1: return 'Learning';
            case 2: return 'Review';
            case 3: return 'Relearning';
            default: return 'Suspended';
        }
    }
}

window.AnkiScheduler = AnkiScheduler;
