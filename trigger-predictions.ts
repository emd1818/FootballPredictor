import { getDb } from './server/db';
import { generatePrediction } from './server/prediction-engine';
import { predictions } from './drizzle/schema';

async function triggerPredictions() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('Database not available');
      process.exit(1);
    }

    // Get all matches
    const matches = await db.query.matches.findMany({
      limit: 20,
    });

    console.log(`Found ${matches.length} matches`);

    let generated = 0;
    for (const match of matches) {
      try {
        const prediction = await generatePrediction(match);
        
        // Insert into database
        await db.insert(predictions).values({
          matchId: match.id,
          prediction: prediction.prediction,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
          oddsMovementScore: prediction.oddsMovementScore,
          volatilityScore: prediction.volatilityScore,
          homeFormScore: prediction.homeFormScore,
          awayFormScore: prediction.awayFormScore,
          h2hAdvantage: prediction.h2hAdvantage,
          riskLevel: prediction.riskLevel,
          valueScore: prediction.valueScore,
          keyInsights: prediction.keyInsights,
          bookmakerDisagreement: prediction.bookmakerDisagreement,
          homeWinOdds: prediction.homeWinOdds,
          drawOdds: prediction.drawOdds,
          awayWinOdds: prediction.awayWinOdds,
        });

        console.log(`✓ Generated prediction for ${match.homeTeam} vs ${match.awayTeam}: ${prediction.confidence}% confidence (form: ${prediction.homeFormScore}/${prediction.awayFormScore}, h2h: ${prediction.h2hAdvantage})`);
        generated++;
      } catch (error) {
        console.error(`✗ Failed for ${match.homeTeam} vs ${match.awayTeam}:`, error);
      }
    }

    console.log(`\nGenerated ${generated}/${matches.length} predictions`);
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

triggerPredictions();
