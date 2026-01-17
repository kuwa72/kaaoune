import { NextResponse } from 'next/server';
import { scrapeProperty } from '@/lib/scraper';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        const data = await scrapeProperty(url);
        return NextResponse.json(data);
    } catch (error) {
        console.error('Extraction error:', error);
        return NextResponse.json(
            { error: 'Failed to extract data' },
            { status: 500 }
        );
    }
}
