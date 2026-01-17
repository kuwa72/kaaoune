import { NextResponse } from 'next/server';
import { getProperties, addProperty, updateRating, deleteProperty, updatePropertyStatus } from '@/lib/storage';
import { scrapeProperty } from '@/lib/scraper';

export async function GET() {
    const properties = await getProperties();
    return NextResponse.json(properties);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Case 1: Add new property via URL
        if (body.url) {
            // Scrape first
            const data = await scrapeProperty(body.url);
            // Then save
            const saved = await addProperty(data);
            return NextResponse.json(saved);
        }

        // Case 2: Update Rating
        if (body.action === 'rate' && body.id && body.userId && body.rating) {
            const updated = await updateRating(body.id, body.userId, body.rating);
            return NextResponse.json(updated);
        }

        // Case 2.5: Update Status
        if (body.action === 'status' && body.id && body.status) {
            const updated = await updatePropertyStatus(body.id, body.status);
            return NextResponse.json(updated);
        }

        // Case 3: Refresh Property Info
        if (body.action === 'refresh' && body.id) {
            const properties = await getProperties();
            const property = properties.find(p => p.id === body.id);
            if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            // Re-scrape
            const newData = await scrapeProperty(property.url);
            // Update
            const { refreshProperty } = await import('@/lib/storage');
            const updated = await refreshProperty(body.id, newData);
            return NextResponse.json(updated);
        }

        // Case 4: Manual Update
        if (body.action === 'update' && body.id && body.updates) {
            const { updateProperty } = await import('@/lib/storage');
            const updated = await updateProperty(body.id, body.updates);
            return NextResponse.json(updated);
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    await deleteProperty(id);
    return NextResponse.json({ success: true });
}
