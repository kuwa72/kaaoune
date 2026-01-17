import fs from 'fs/promises';
import path from 'path';
import { PropertyData } from './scraper';

const DB_PATH = path.join(process.cwd(), 'db.json');

export interface UserRating {
    userId: string;
    score: 'good' | 'bad' | null;
    comment: string;
    updatedAt: string;
}

export interface UserConfig {
    id: string;
    name: string;
    icon: string;
}

export interface UserSettings {
    users: UserConfig[];
    loan: {
        interestRate: number; // 0.5 for 0.5%
        termYears: number;   // 35
        downPayment: number; // In yen, e.g., 2000000
    };
}


export type PropertyStatus =
    | 'considering'      // 検討中
    | 'exterior_viewed'  // 外観確認済み
    | 'viewing_scheduled' // 内見予定
    | 'viewed'           // 内見済み
    | 'applying'         // 申込中/手続き中
    | 'contracted'       // 契約済み
    | 'excluded'         // 選外/検討除外
    | 'sold_out';        // 物件なし/掲載終了


export interface PropertyWithId extends PropertyData {
    id: string;
    createdAt: string;
    status: PropertyStatus;
    ratings: UserRating[];
    manuallyEditedFields?: string[];
}

// Initial DB state
const defaultDb = {
    properties: [] as PropertyWithId[],
    settings: {
        users: [
            { id: 'u1', name: 'ユーザー1', icon: '👤' }
        ],
        loan: {
            interestRate: 0.5,
            termYears: 35,
            downPayment: 0
        }
    } as UserSettings
};

let isWriting = false;

async function saveDb(db: any) {
    // Basic mutex to prevent concurrent writes within the same process
    while (isWriting) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    isWriting = true;
    try {
        const tempPath = `${DB_PATH}.tmp`;
        const data = JSON.stringify(db, null, 2);
        await fs.writeFile(tempPath, data, 'utf-8');
        await fs.rename(tempPath, DB_PATH);
    } finally {
        isWriting = false;
    }
}

async function getDb() {
    await ensureDb();
    try {
        const data = await fs.readFile(DB_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Failed to parse DB, falling back to default", e);
        return { ...defaultDb };
    }
}


async function ensureDb() {
    try {
        await fs.access(DB_PATH);
    } catch {
        await saveDb(defaultDb);
    }
    await migrateDb();
}

async function migrateDb() {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    let db;
    try {
        db = JSON.parse(data);
    } catch (e) {
        return; // Corrupted JSON, handle elsewhere or let ensureDb overwrite
    }

    let changed = false;

    // Migrate settings
    if (!db.settings || !db.settings.users || db.settings.users.length === 0) {
        const oldSettings = db.settings || {};
        const users: UserConfig[] = [];

        if (oldSettings.partnerA) {
            users.push({ id: 'u1', name: oldSettings.partnerA.name || 'ユーザー1', icon: oldSettings.partnerA.icon || '👤' });
        }
        if (oldSettings.partnerB) {
            users.push({ id: 'u2', name: oldSettings.partnerB.name || 'ユーザー2', icon: oldSettings.partnerB.icon || '👤' });
        }

        if (users.length === 0) {
            users.push({ id: 'u1', name: 'ユーザー1', icon: '👤' });
        }

        db.settings = {
            users,
            loan: defaultDb.settings.loan
        };
        changed = true;
    } else if (!db.settings.loan) {
        db.settings.loan = defaultDb.settings.loan;
        changed = true;
    }

    // Migrate properties
    if (db.properties) {
        for (const prop of db.properties) {
            if (prop.ratings && !Array.isArray(prop.ratings)) {
                const oldRatings = prop.ratings;
                const newRatings: UserRating[] = [];

                if (oldRatings.partnerA && (oldRatings.partnerA.score || oldRatings.partnerA.comment)) {
                    newRatings.push({
                        userId: 'u1',
                        score: oldRatings.partnerA.score,
                        comment: oldRatings.partnerA.comment,
                        updatedAt: prop.createdAt
                    });
                }
                if (oldRatings.partnerB && (oldRatings.partnerB.score || oldRatings.partnerB.comment)) {
                    newRatings.push({
                        userId: 'u2',
                        score: oldRatings.partnerB.score,
                        comment: oldRatings.partnerB.comment,
                        updatedAt: prop.createdAt
                    });
                }

                prop.ratings = newRatings;
                changed = true;
            } else if (!prop.ratings) {
                prop.ratings = [];
                changed = true;
            } else if (Array.isArray(prop.ratings)) {
                // Compatibility for user-a/user-b ids
                let propChanged = false;
                for (const r of prop.ratings) {
                    if (r.userId === 'user-a') { r.userId = 'u1'; propChanged = true; }
                    if (r.userId === 'user-b') { r.userId = 'u2'; propChanged = true; }
                }
                if (propChanged) changed = true;
            }
        }
    }

    // Fix settings ids if they are user-a/user-b
    if (db.settings?.users) {
        for (const u of db.settings.users) {
            if (u.id === 'user-a') { u.id = 'u1'; changed = true; }
            if (u.id === 'user-b') { u.id = 'u2'; changed = true; }
        }
    }

    if (changed) {
        await saveDb(db);
    }
}

export async function getProperties(): Promise<PropertyWithId[]> {
    const db = await getDb();
    return db.properties || [];
}

export async function getSettings(): Promise<UserSettings> {
    const db = await getDb();
    return db.settings || defaultDb.settings;
}


export async function addProperty(property: PropertyData): Promise<PropertyWithId> {
    const db = await getDb();
    const properties = db.properties;

    // Check for duplicates
    const existing = properties.find((p: any) => p.url === property.url);
    if (existing) return existing;

    const newProperty: PropertyWithId = {
        ...property,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'considering',
        ratings: []
    };

    db.properties.unshift(newProperty);
    await saveDb(db);
    return newProperty;
}


export async function updateRating(
    id: string,
    userId: string,
    ratingData: { score: 'good' | 'bad' | null; comment: string }
): Promise<PropertyWithId | null> {
    const db = await getDb();
    const index = db.properties.findIndex((p: any) => p.id === id);

    if (index === -1) return null;

    const prop = db.properties[index];

    const ratingIndex = prop.ratings.findIndex((r: UserRating) => r.userId === userId);
    const now = new Date().toISOString();

    if (ratingIndex > -1) {
        prop.ratings[ratingIndex] = {
            ...prop.ratings[ratingIndex],
            ...ratingData,
            updatedAt: now
        };
    } else {
        prop.ratings.push({
            userId,
            ...ratingData,
            updatedAt: now
        });
    }

    await saveDb(db);
    return db.properties[index];
}


export async function updatePropertyStatus(
    id: string,
    status: PropertyStatus
): Promise<PropertyWithId | null> {
    console.log(`[Storage] Updating status: id=${id}, status=${status}`);
    const db = await getDb();
    const index = db.properties.findIndex((p: any) => p.id === id);

    if (index === -1) {
        console.error(`[Storage] Property not found for status update: ${id}`);
        return null;
    }

    db.properties[index].status = status;
    await saveDb(db);
    console.log(`[Storage] Status updated successfully: ${id} -> ${status}`);
    return db.properties[index];
}



export async function deleteProperty(id: string): Promise<void> {
    const db = await getDb();
    db.properties = db.properties.filter((p: any) => p.id !== id);
    await saveDb(db);
}


export async function refreshProperty(id: string, data: PropertyData): Promise<PropertyWithId | null> {
    const db = await getDb();
    const index = db.properties.findIndex((p: any) => p.id === id);

    if (index === -1) return null;

    const current = db.properties[index];
    const editedFields = current.manuallyEditedFields || [];

    // Filter out data fields that were manually edited
    const updateData: any = { ...data };

    // Check top level fields
    const topLevelFields = ['price', 'area', 'yearBuilt', 'units', 'station', 'stationMinute', 'parkingStatus'];
    for (const field of topLevelFields) {
        if (editedFields.includes(field)) {
            // @ts-ignore
            delete updateData[field];
        }
    }

    // Check nested fees
    if (updateData.fees) {
        if (editedFields.includes('fees.management')) delete updateData.fees.management;
        if (editedFields.includes('fees.repair')) delete updateData.fees.repair;
        if (editedFields.includes('fees.parking')) delete updateData.fees.parking;
    }

    // Merge new data while preserving internal fields and manually edited fields
    db.properties[index] = {
        ...current,
        ...updateData,
        // Ensure nested fees are merged correctly if updateData.fees was modified
        fees: {
            ...current.fees,
            ...(updateData.fees || {})
        }
    };

    await saveDb(db);
    return db.properties[index];
}

export async function updateProperty(
    id: string,
    updates: Partial<PropertyWithId>
): Promise<PropertyWithId | null> {
    const db = await getDb();
    const index = db.properties.findIndex((p: any) => p.id === id);

    if (index === -1) return null;

    const current = db.properties[index];
    const editedFields = new Set(current.manuallyEditedFields || []);

    // Track which fields are being manually updated
    Object.keys(updates).forEach(key => {
        if (key === 'fees' && updates.fees) {
            if ('management' in updates.fees) editedFields.add('fees.management');
            if ('repair' in updates.fees) editedFields.add('fees.repair');
            if ('parking' in updates.fees) editedFields.add('fees.parking');
        } else if (key !== 'manuallyEditedFields' && key !== 'ratings' && key !== 'status') {
            editedFields.add(key);
        }
    });

    db.properties[index] = {
        ...current,
        ...updates,
        fees: updates.fees ? { ...current.fees, ...updates.fees } : current.fees,
        manuallyEditedFields: Array.from(editedFields)
    };

    await saveDb(db);
    return db.properties[index];
}

export async function updateUserSettings(
    updates: Partial<UserSettings>
): Promise<UserSettings> {
    const db = await getDb();

    db.settings = { ...db.settings, ...updates };

    await saveDb(db);
    return db.settings;
}
