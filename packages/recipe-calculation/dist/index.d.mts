import { NestedRecipe, Prerequisites } from 'recipe-nesting';

type ExtendRecipeTree<TBaseTree, TProperties> = Omit<TBaseTree, 'type' | 'components'> & {
    type: 'Recipe' | 'Item' | 'Currency';
    components?: Array<ExtendRecipeTree<TBaseTree, TProperties>>;
} & TProperties;
type RecipeTree = ExtendRecipeTree<NestedRecipe, {
    __never?: never;
}>;
type RecipeTreeWithQuantity = ExtendRecipeTree<RecipeTree, {
    output: number;
    totalQuantity: number;
    usedQuantity: number;
}>;
type RecipeTreeWithPrices = ExtendRecipeTree<RecipeTreeWithQuantity, {
    buyPriceEach: number | false;
    buyPrice: number | false;
    craftPrice?: number;
    decisionPrice: number | false;
    craftResultPrice: number | false;
    craftDecisionPrice: number | false;
}>;
type RecipeTreeWithCraftFlags = ExtendRecipeTree<RecipeTreeWithPrices, {
    craft: boolean;
}>;

declare function cheapestTree(amount: number, tree: NestedRecipe, itemPrices: Record<string, number>, availableItems?: Record<string, number>, forceBuyItems?: Array<number>, valueOwnItems?: boolean, userEfficiencyTiers?: Record<string, string>): RecipeTreeWithCraftFlags;

declare function craftingSteps(tree: RecipeTreeWithCraftFlags): {
    crafts: number;
    output: undefined;
    id: number;
    type: "Item" | "Recipe" | "Currency";
    quantity: number;
    minRating: number | null;
    disciplines: Array<string>;
    merchant?: {
        name: string;
        locations: Array<string>;
    };
    prerequisites: Prerequisites;
    components: Array<{
        id: number;
        type: "Item" | "Recipe" | "Currency";
        quantity: number;
    }>;
    hasCraftedComponents: boolean;
}[];

type DailyCooldownsBreakdown = Record<string, number>;
declare function dailyCooldowns(tree: RecipeTreeWithCraftFlags, breakdown?: DailyCooldownsBreakdown): DailyCooldownsBreakdown;

declare function recipeItems(tree: RecipeTreeWithCraftFlags): number[];

declare function useVendorPrices(priceMap: Record<string, number>): Record<string, number>;

declare function updateTree(amount: number, tree: RecipeTreeWithCraftFlags, itemPrices: Record<string, number>, availableItems?: Record<string, number>): RecipeTreeWithCraftFlags;

interface UsedItemsBreakdown {
    buy: Record<string, number>;
    available: Record<string, number>;
    currency: Record<string, number>;
}
declare function usedItems(tree: RecipeTreeWithCraftFlags, breakdown?: UsedItemsBreakdown): UsedItemsBreakdown;

declare const staticItems: {
    dailyCooldowns: number[];
    buyableDailyCooldowns: number[];
    vendorItems: {};
};

export { cheapestTree, craftingSteps, dailyCooldowns, recipeItems, staticItems, updateTree, useVendorPrices, usedItems };
