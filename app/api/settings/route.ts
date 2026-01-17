import { NextResponse } from 'next/server';
import { getSettings, updateUserSettings } from '@/lib/storage';

export async function GET() {
    const settings = await getSettings();
    return NextResponse.json(settings);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const updated = await updateUserSettings(body);
        return NextResponse.json(updated);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
