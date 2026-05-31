import type { BlueprintCategoryCapability, BlueprintMappingEntry } from '../shared/types';
import { parseSaveFile, writeSaveFile } from './parseSave';

export interface ApplyBlueprintCategoriesResult {
  categoriesCreated: string[];
  subcategoriesCreated: string[];
  assignments: Array<{ blueprintStem: string; category: string; subcategory: string }>;
  verification: { passed: boolean; message: string; categoryCounts?: Record<string, number>; undefinedCount?: number };
}

type AnyRecord = Record<string, any>;

export async function applyBlueprintCategories(savePath: string, entries: BlueprintMappingEntry[], capability: BlueprintCategoryCapability): Promise<ApplyBlueprintCategoriesResult> {
  const assignments = entries.map((entry) => ({
    blueprintStem: entry.blueprintStem,
    category: entry.category,
    subcategory: entry.subcategory
  }));

  if (!capability.canWrite) {
    return {
      categoriesCreated: [],
      subcategoriesCreated: [],
      assignments,
      verification: { passed: false, message: capability.reason }
    };
  }

  const save = await parseSaveFile(savePath);
  const model = getBlueprintCategoryModel(save);
  const categoriesCreated: string[] = [];
  const subcategoriesCreated: string[] = [];
  const desiredBlueprintStems = [...new Set(assignments.map((assignment) => assignment.blueprintStem))];
  for (const blueprintStem of desiredBlueprintStems) {
    removeBlueprintFromAllSubcategories(model.categoryRecords.values, blueprintStem);
  }

  for (const assignment of assignments) {
    const { category, createdCategory } = ensureCategory(model.categoryRecords.values, assignment.category);
    if (createdCategory) categoriesCreated.push(assignment.category);
    const { subcategory, createdSubcategory } = ensureSubcategory(category, assignment.subcategory);
    if (createdSubcategory) subcategoriesCreated.push(`${assignment.category}/${assignment.subcategory}`);
    const names = getBlueprintNamesArray(subcategory);
    if (!names.values.includes(assignment.blueprintStem)) names.values.push(assignment.blueprintStem);
  }

  await writeSaveFile(savePath, save);
  const reread = await parseSaveFile(savePath);
  const verification = verifyAssignments(reread, assignments);
  return {
    categoriesCreated: [...new Set(categoriesCreated)],
    subcategoriesCreated: [...new Set(subcategoriesCreated)],
    assignments,
    verification
  };
}

export function canAccessBlueprintCategoryRecords(save: unknown): { canWrite: boolean; reason: string; evidence: unknown[] } {
  try {
    const model = getBlueprintCategoryModel(save);
    return {
      canWrite: model.categoryRecords.values.length > 0,
      reason: 'Found mBlueprintCategoryRecords ArrayProperty with editable category records.',
      evidence: [{ gameStateInstance: model.gameState.instanceName, categoryCount: model.categoryRecords.values.length }]
    };
  } catch (error) {
    return {
      canWrite: false,
      reason: error instanceof Error ? error.message : String(error),
      evidence: []
    };
  }
}

function getBlueprintCategoryModel(save: unknown): { gameState: AnyRecord; categoryRecords: AnyRecord } {
  const objects = Object.values((save as AnyRecord).levels ?? {}).flatMap((level: any) => level?.objects ?? []) as AnyRecord[];
  const gameState = objects.find(
    (object) =>
      object?.instanceName === 'Persistent_Level:PersistentLevel.BP_GameState_C_2147477645' ||
      String(object?.instanceName ?? '').includes('BP_GameState_C') ||
      String(object?.typePath ?? '').includes('BP_GameState_C')
  );
  if (!gameState) throw new Error('Could not find BP_GameState_C object in parsed save.');

  let categoryHost = gameState;
  let categoryRecords = getProperty(gameState.properties, 'mBlueprintCategoryRecords');
  if (!categoryRecords) {
    const subsystemRef = getProperty(gameState.properties, 'mBlueprintSubsystem')?.value;
    const subsystemPath = subsystemRef?.pathName ?? subsystemRef;
    const subsystem = objects.find((object) => object?.instanceName === subsystemPath || String(object?.instanceName ?? '').includes('BlueprintSubsystem'));
    if (subsystem) {
      categoryHost = subsystem;
      categoryRecords = getProperty(subsystem.properties, 'mBlueprintCategoryRecords');
    }
  }
  if (!categoryRecords) {
    const directHost = objects.find((object) => getProperty(object?.properties, 'mBlueprintCategoryRecords'));
    if (directHost) {
      categoryHost = directHost;
      categoryRecords = getProperty(directHost.properties, 'mBlueprintCategoryRecords');
    }
  }

  if (!categoryRecords || categoryRecords.type !== 'ArrayProperty' || !Array.isArray(categoryRecords.values)) {
    throw new Error('mBlueprintCategoryRecords is missing or is not an ArrayProperty.');
  }
  return { gameState: categoryHost, categoryRecords };
}

function ensureCategory(categories: AnyRecord[], name: string): { category: AnyRecord; createdCategory: boolean } {
  const existing = categories.find((category) => getStringPropertyValue(getStructProperties(category), 'CategoryName') === name);
  if (existing) {
    normalizeMenuPriorityIfNeeded(getStructProperties(existing), nextMenuPriority(categories.filter((item) => item !== existing).map((item) => getProperty(getStructProperties(item), 'MenuPriority')?.value)));
    return { category: existing, createdCategory: false };
  }
  const template = categories.find((category) => getStringPropertyValue(getStructProperties(category), 'IsUndefined') === true) ?? categories[0];
  if (!template) throw new Error('Cannot create category: no BlueprintCategoryRecord template exists.');
  const category = deepClone(template);
  setStringLikeProperty(getStructProperties(category), 'CategoryName', name);
  setBooleanPropertyIfPresent(getStructProperties(category), 'IsUndefined', false);
  setNumberPropertyIfPresent(getStructProperties(category), 'MenuPriority', nextMenuPriority(categories.map((item) => getProperty(getStructProperties(item), 'MenuPriority')?.value)));
  const subcategories = getSubCategoryRecordsArray(category);
  const subTemplate = subcategories.values[0];
  if (!subTemplate) throw new Error('Cannot create category: no BlueprintSubCategoryRecord template exists.');
  subcategories.values = [];
  const undefinedSubcategory = deepClone(subTemplate);
  setStringLikeProperty(getStructProperties(undefinedSubcategory), 'SubCategoryName', 'Undefined');
  setBooleanPropertyIfPresent(getStructProperties(undefinedSubcategory), 'IsUndefined', true);
  setNumberPropertyIfPresent(getStructProperties(undefinedSubcategory), 'MenuPriority', 0);
  getBlueprintNamesArray(undefinedSubcategory).values = [];
  subcategories.values.push(undefinedSubcategory);
  categories.push(category);
  return { category, createdCategory: true };
}

function ensureSubcategory(category: AnyRecord, name: string): { subcategory: AnyRecord; createdSubcategory: boolean } {
  const subcategories = getSubCategoryRecordsArray(category);
  const existing = subcategories.values.find((subcategory: AnyRecord) => getStringPropertyValue(getStructProperties(subcategory), 'SubCategoryName') === name);
  if (existing) {
    normalizeMenuPriorityIfNeeded(getStructProperties(existing), nextMenuPriority(subcategories.values.filter((item: AnyRecord) => item !== existing).map((item: AnyRecord) => getProperty(getStructProperties(item), 'MenuPriority')?.value)));
    return { subcategory: existing, createdSubcategory: false };
  }
  const template = subcategories.values[0] ?? findAnySubcategoryTemplate(category);
  if (!template) throw new Error('Cannot create subcategory: no BlueprintSubCategoryRecord template exists.');
  const subcategory = deepClone(template);
  setStringLikeProperty(getStructProperties(subcategory), 'SubCategoryName', name);
  setBooleanPropertyIfPresent(getStructProperties(subcategory), 'IsUndefined', false);
  setNumberPropertyIfPresent(getStructProperties(subcategory), 'MenuPriority', nextMenuPriority(subcategories.values.map((item: AnyRecord) => getProperty(getStructProperties(item), 'MenuPriority')?.value)));
  getBlueprintNamesArray(subcategory).values = [];
  subcategories.values.push(subcategory);
  return { subcategory, createdSubcategory: true };
}

function findAnySubcategoryTemplate(category: AnyRecord): AnyRecord | null {
  const subcategories = getSubCategoryRecordsArray(category);
  return subcategories.values[0] ?? null;
}

function removeBlueprintFromAllSubcategories(categories: AnyRecord[], blueprintStem: string): void {
  for (const category of categories) {
    const subcategories = getSubCategoryRecordsArray(category);
    for (const subcategory of subcategories.values) {
      const names = getBlueprintNamesArray(subcategory);
      names.values = names.values.filter((value: unknown) => value !== blueprintStem);
    }
  }
}

function verifyAssignments(save: unknown, assignments: Array<{ blueprintStem: string; category: string; subcategory: string }>): { passed: boolean; message: string; categoryCounts?: Record<string, number>; undefinedCount?: number } {
  try {
    const model = getBlueprintCategoryModel(save);
    const missing: string[] = [];
    const categoryCounts: Record<string, number> = {};
    let undefinedCount = 0;
    for (const category of model.categoryRecords.values) {
      const categoryName = String(getStringPropertyValue(getStructProperties(category), 'CategoryName'));
      let count = 0;
      for (const subcategory of getSubCategoryRecordsArray(category).values) {
        count += getBlueprintNamesArray(subcategory).values.length;
      }
      categoryCounts[categoryName] = count;
      if (isUndefinedRecord(getStructProperties(category), categoryName)) undefinedCount += count;
    }
    for (const assignment of assignments) {
      const category = model.categoryRecords.values.find((item: AnyRecord) => getStringPropertyValue(getStructProperties(item), 'CategoryName') === assignment.category);
      const subcategory = category ? getSubCategoryRecordsArray(category).values.find((item: AnyRecord) => getStringPropertyValue(getStructProperties(item), 'SubCategoryName') === assignment.subcategory) : null;
      const hasBlueprint = subcategory ? getBlueprintNamesArray(subcategory).values.includes(assignment.blueprintStem) : false;
      if (!hasBlueprint) missing.push(`${assignment.blueprintStem} -> ${assignment.category}/${assignment.subcategory}`);
    }
    return missing.length === 0
      ? { passed: true, message: `All blueprint category assignments were verified after rereading the save. Undefined contains ${undefinedCount} assigned blueprint name(s).`, categoryCounts, undefinedCount }
      : { passed: false, message: `Missing assignments: ${missing.join(', ')}`, categoryCounts, undefinedCount };
  } catch (error) {
    return { passed: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function getSubCategoryRecordsArray(category: AnyRecord): AnyRecord {
  const property = getProperty(getStructProperties(category), 'SubCategoryRecords');
  if (!property || property.type !== 'ArrayProperty' || !Array.isArray(property.values)) {
    throw new Error('BlueprintCategoryRecord.SubCategoryRecords is missing or is not an ArrayProperty.');
  }
  return property;
}

function getBlueprintNamesArray(subcategory: AnyRecord): AnyRecord {
  const property = getProperty(getStructProperties(subcategory), 'BlueprintNames');
  if (!property || property.type !== 'ArrayProperty' || !Array.isArray(property.values)) {
    throw new Error('BlueprintSubCategoryRecord.BlueprintNames is missing or is not an ArrayProperty.');
  }
  return property;
}

function getStructProperties(value: AnyRecord): AnyRecord {
  if (value?.properties) return value.properties;
  if (value?.value?.properties) return value.value.properties;
  throw new Error('Expected a dynamic struct value with properties.');
}

function getProperty(properties: AnyRecord, name: string): AnyRecord | null {
  const property = properties?.[name];
  return Array.isArray(property) ? property[0] : property ?? null;
}

function getStringPropertyValue(properties: AnyRecord, name: string): unknown {
  return getProperty(properties, name)?.value;
}

function setStringLikeProperty(properties: AnyRecord, name: string, value: string): void {
  const property = getProperty(properties, name);
  if (!property || typeof property.value !== 'string') throw new Error(`Expected string-like property ${name}.`);
  property.value = value;
}

function setBooleanPropertyIfPresent(properties: AnyRecord, name: string, value: boolean): void {
  const property = getProperty(properties, name);
  if (property && typeof property.value === 'boolean') property.value = value;
  if (property?.type === 'ByteProperty' && property.value && typeof property.value === 'object' && 'value' in property.value) {
    property.value.value = value ? 1 : 0;
  }
}

function setNumberPropertyIfPresent(properties: AnyRecord, name: string, value: number): void {
  const property = getProperty(properties, name);
  if (property && typeof property.value === 'number') property.value = value;
}

function nextMenuPriority(values: unknown[]): number {
  const finiteValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value < 1_000_000);
  return finiteValues.length === 0 ? 1 : Math.max(...finiteValues) + 1;
}

function normalizeMenuPriorityIfNeeded(properties: AnyRecord, fallback: number): void {
  const property = getProperty(properties, 'MenuPriority');
  if (property && (typeof property.value !== 'number' || !Number.isFinite(property.value) || property.value > 1_000_000)) {
    property.value = fallback;
  }
}

function isUndefinedRecord(properties: AnyRecord, name: string): boolean {
  const isUndefined = getProperty(properties, 'IsUndefined');
  if (isUndefined?.value === true) return true;
  if (isUndefined?.value && typeof isUndefined.value === 'object' && isUndefined.value.value === 1) return true;
  return name === '未定义' || name === 'Undefined';
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}
