import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Function to get today's date in ISO format
const getTodayDate = () => {
    return new Date().toISOString();
};

// Function to get an older date (more than a day old)
const getOlderDate = (daysAgo) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
};

// Function to generate dummy news data
const generateNewsData = () => {
    return {
        "TBIO": [
            {
                "author": "Bibhu Pattnaik",
                "content": "",
                "created_at": getTodayDate(),
                "headline": "Tbio announces new product launch",
                "id": 41082791,
                "images": [
                    {
                        "size": "large",
                        "url": "https://example.com/tbio-large.jpg"
                    },
                    {
                        "size": "small",
                        "url": "https://example.com/tbio-small.jpg"
                    },
                    {
                        "size": "thumb",
                        "url": "https://example.com/tbio-thumb.jpg"
                    }
                ],
                "source": "example",
                "summary": "Tbio has launched a new product that is expected to revolutionize the industry.",
                "symbols": [],
                "updated_at": getTodayDate(),
                "url": "https://www.example.com/tbio-launch"
            }
        ],
        "NCNA": [
            {
                "author": "John Doe",
                "content": "",
                "created_at": getTodayDate(),
                "headline": "Ncna reports quarterly earnings",
                "id": 41082772,
                "images": [
                    {
                        "size": "large",
                        "url": "https://example.com/ncna-large.jpg"
                    },
                    {
                        "size": "small",
                        "url": "https://example.com/ncna-small.jpg"
                    },
                    {
                        "size": "thumb",
                        "url": "https://example.com/ncna-thumb.jpg"
                    }
                ],
                "source": "example",
                "summary": "Ncna's quarterly earnings report shows significant growth compared to last year.",
                "symbols": [],
                "updated_at": getTodayDate(),
                "url": "https://www.example.com/ncna-earnings"
            },
            {
                "author": "Alice Johnson",
                "content": "",
                "created_at": getOlderDate(2), // 2 days ago
                "headline": "Ncna signs new partnership agreement",
                "id": 41082773,
                "images": [
                    {
                        "size": "large",
                        "url": "https://example.com/ncna-partnership-large.jpg"
                    },
                    {
                        "size": "small",
                        "url": "https://example.com/ncna-partnership-small.jpg"
                    },
                    {
                        "size": "thumb",
                        "url": "https://example.com/ncna-partnership-thumb.jpg"
                    }
                ],
                "source": "example",
                "summary": "Ncna has entered a new partnership to expand its market reach.",
                "symbols": [],
                "updated_at": getOlderDate(2),
                "url": "https://www.example.com/ncna-partnership"
            }
        ],
        "gsiw": [],
        "UXIN": [
            {
                "author": "Jane Smith",
                "content": "",
                "created_at": getTodayDate(),
                "headline": "Uxin partners with major auto manufacturer",
                "id": 41082795,
                "images": [
                    {
                        "size": "large",
                        "url": "https://example.com/uxin-large.jpg"
                    },
                    {
                        "size": "small",
                        "url": "https://example.com/uxin-small.jpg"
                    },
                    {
                        "size": "thumb",
                        "url": "https://example.com/uxin-thumb.jpg"
                    }
                ],
                "source": "example",
                "summary": "Uxin has formed a partnership with a leading auto manufacturer to enhance their product offerings.",
                "symbols": [],
                "updated_at": getTodayDate(),
                "url": "https://www.example.com/uxin-partnership"
            },
            {
                "author": "Alice Johnson",
                "content": "",
                "created_at": getOlderDate(3), // 3 days ago
                "headline": "Uxin expands its service offerings",
                "id": 41082796,
                "images": [
                    {
                        "size": "large",
                        "url": "https://example.com/uxin-expansion-large.jpg"
                    },
                    {
                        "size": "small",
                        "url": "https://example.com/uxin-expansion-small.jpg"
                    },
                    {
                        "size": "thumb",
                        "url": "https://example.com/uxin-expansion-thumb.jpg"
                    }
                ],
                "source": "example",
                "summary": "Uxin is expanding its services to include more features for customers.",
                "symbols": [],
                "updated_at": getOlderDate(3),
                "url": "https://www.example.com/uxin-expansion"
            }
        ]
    };
};

// Endpoint to fetch news
app.get('/v1beta1/news', (req, res) => {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
    const response = {
        news: [],
        next_page_token: null
    };

    // Generate the news data dynamically
    const newsData = generateNewsData();

    symbols.forEach(symbol => {
        if (newsData[symbol]) {
            response.news.push(...newsData[symbol]);
        }
    });

    res.json(response);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Test server is running on http://localhost:${PORT}`);
});
