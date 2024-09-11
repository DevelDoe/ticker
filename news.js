import { restClient } from '@polygon.io/client-js';
import dotenv from 'dotenv';

dotenv.config();

// Create the Polygon client instance
const rest = restClient(process.env.POLY_API_KEY);

async function getNews(ticker) {
    try {
        const news = await rest.stocks.news(ticker);
        return news;
    } catch (error) {
        console.error('Error fetching news:', error);
        return null;
    }
}

(async () => {
    const ticker = 'AAPL'; // Change this to the ticker you're interested in
    const newsData = await getNews(ticker);

    if (newsData && newsData.results) {
        console.log(`News for ticker ${ticker}:`);
        newsData.results.forEach(newsItem => {
            console.log(`- ${newsItem.title}: ${newsItem.summary}`);
        });
    } else {
        console.log('No news found.');
    }
})();
