// Anki Scheduler (SM-2 Algorithm)

class AnkiScheduler {
    constructor() {
        this.config = {
            // Learning steps in minutes
            learningSteps: [1, 10],
            // Graduating interval in days
            graduatingInterval: 1,
            easyInterval: 4,
            // Starting ease factor (250%)
            initialEase: 2.5,
            easyBonus: 1.3,
            intervalModifier: 1.0,
            hardInterval: 1.2,
            // Lapse settings
            lapseSteps: [10],
            newInterval: 0.5,
            minimumInterval: 1,
            leechThreshold: 8,
            // Maximum interval in days
            maximumInterval: 36500
        };
    }

    // Answer types: 1=Again, 2=Hard, 3=Good, 4=Easy
    answerCard(card, rating, config = this.config) {
        const now = Math.floor(Date.now() / 1000);
        const dayInSeconds = 86400;
        
        // Initialize card if needed
        card.reviews = card.reviews || 0;
        card.lapses = card.lapses || 0;
        card.ease = card.ease || config.initialEase;
        card.interval = card.interval || 0;
        
        // Record review
        card.lastReview = now;
        card.reviews++;
        
        // Handle different card states
        if (card.queue === 0 || card.queue === 3) {
            // New card or in relearning
            return this._answerNewOrRelearningCard(card, rating, now, config);
        } else if (card.queue === 1) {
            // Learning card
            return this._answerLearningCard(card, rating, now, config);
        } else if (card.queue === 2) {
            // Review card
            return this._answerReviewCard(card, rating, now, config);
        }
        
        return card;
    }

    _answerNewOrRelearningCard(card, rating, now, config) {
        if (rating === 1) {
            // Again - put back in learning
            card.queue = 1;
            card.type = 1; // Learning
            card.due = now + (config.learningSteps[0] * 60); // First step in minutes
            card.remainingSteps = config.learningSteps.length;
            card.lapses = (card.lapses || 0) + 1;
        } else if (rating === 2 || rating === 3) {
            // Hard/Good - graduate
            card.queue = 2;
            card.type = 2; // Review
            card.interval = rating === 3 ? config.graduatingInterval : 1;
            card.due = now + (card.interval * 86400);
            card.ease = config.initialEase;
            card.factor = Math.round(card.ease * 1000);
        } else if (rating === 4) {
            // Easy - graduate with bonus
            card.queue = 2;
            card.type = 2; // Review
            card.interval = config.easyInterval;
            card.due = now + (card.interval * 86400);
            card.ease = config.initialEase + 0.15;
            card.factor = Math.round(card.ease * 1000);
        }
        
        return card;
    }

    _answerLearningCard(card, rating, now, config) {
        if (rating === 1) {
            // Again - restart learning
            card.due = now + (config.learningSteps[0] * 60);
            card.remainingSteps = config.learningSteps.length;
        } else {
            // Advance in learning steps
            const remaining = card.remainingSteps || config.learningSteps.length;
            if (remaining > 1) {
                // Move to next step
                card.remainingSteps = remaining - 1;
                const stepIndex = config.learningSteps.length - remaining;
                card.due = now + (config.learningSteps[stepIndex] * 60);
            } else {
                // Finished learning - graduate
                card.queue = 2;
                card.type = 2; // Review
                card.interval = config.graduatingInterval;
                card.due = now + (card.interval * 86400);
                card.ease = config.initialEase;
                card.factor = Math.round(card.ease * 1000);
            }
        }
        
        return card;
    }

    _answerReviewCard(card, rating, now, config) {
        if (rating === 1) {
            // Again - lapse
            card.queue = 3;
            card.type = 3; // Relearning
            card.lapses = (card.lapses || 0) + 1;
            
            // Apply lapse penalty
            card.ease = Math.max(1.3, card.ease - 0.2);
            card.factor = Math.round(card.ease * 1000);
            
            // Reset interval with penalty
            card.interval = Math.max(config.minimumInterval, 
                Math.floor(card.interval * config.newInterval));
            
            // Put in relearning queue
            card.due = now + (config.lapseSteps[0] * 60);
            card.remainingSteps = config.lapseSteps.length;
            
            // Check for leech
            if (card.lapses >= config.leechThreshold) {
                card.flags = card.flags || 0;
                card.flags |= 1; // Mark as leech
            }
        } else {
            // Update ease factor based on rating
            let easeChange = 0;
            if (rating === 2) {
                // Hard
                easeChange = -0.15;
            } else if (rating === 4) {
                // Easy
                easeChange = 0.15;
            }
            
            card.ease = Math.max(1.3, card.ease + easeChange);
            card.factor = Math.round(card.ease * 1000);
            
            // Calculate new interval
            let intervalMultiplier = 1;
            if (rating === 2) {
                intervalMultiplier = config.hardInterval;
            } else if (rating === 3) {
                intervalMultiplier = 1.0;
            } else if (rating === 4) {
                intervalMultiplier = config.easyBonus;
            }
            
            let newInterval = card.interval * card.ease * intervalMultiplier * config.intervalModifier;
            
            // Apply constraints
            newInterval = Math.max(1, Math.floor(newInterval));
            newInterval = Math.min(newInterval, config.maximumInterval);
            
            card.interval = newInterval;
            card.due = now + (newInterval * 86400);
            
            // Keep in review queue
            card.queue = 2;
            card.type = 2; // Review
        }
        
        return card;
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
        if (diff < 604800) return `${Math.floor(diff/86400)}d`;
        if (diff < 2592000) return `${Math.floor(diff/604800)}w`;
        if (diff < 31536000) return `${Math.floor(diff/2592000)}mo`;
        
        return `${Math.floor(diff/31536000)}y`;
    }

    // Get card type name
    getCardType(card) {
        switch(card.type) {
            case 0: return 'New';
            case 1: return 'Learning';
            case 2: return 'Review';
            case 3: return 'Relearning';
            default: return 'Unknown';
        }
    }

    // Calculate due counts
    calculateDueCounts(cards) {
        const now = Math.floor(Date.now() / 1000);
        const today = Math.floor(Date.now() / 86400000);
        
        let newCards = 0;
        let learning = 0;
        let review = 0;
        let totalDue = 0;
        
        cards.forEach(card => {
            if (card.queue === 0) newCards++;
            if (card.queue === 1 || card.queue === 3) {
                if (card.due <= now) {
                    learning++;
                    totalDue++;
                }
            }
            if (card.queue === 2) {
                if (card.due <= today) {
                    review++;
                    totalDue++;
                }
            }
        });
        
        return {
            new: newCards,
            learning,
            review,
            totalDue
        };
    }

    // Get recommended next review time
    getNextReviewTime(card, rating) {
        const now = Math.floor(Date.now() / 1000);
        const config = this.config;
        
        if (rating === 1) {
            // Again - 1 minute
            return now + 60;
        } else if (rating === 2) {
            // Hard - 10 minutes
            return now + 600;
        } else if (rating === 3) {
            // Good - 1 day
            return now + 86400;
        } else if (rating === 4) {
            // Easy - 4 days
            return now + (4 * 86400);
        }
        
        return now;
    }
}

// Export scheduler instance
window.AnkiScheduler = new AnkiScheduler();
