// TODO Extract to shared type library
interface API_Recipes_Entry {
  type: string
  output_item_id: number
  output_upgrade_id?: number
  output_item_count_range?: string
  achievement_id?: number
  merchant?: { name: string; locations: Array<string> }
  output_item_count: number
  min_rating?: number
  disciplines: Array<string>
  flags: Array<string>
  ingredients: Array<{
    type: 'Item' | 'GuildUpgrade' | 'Currency'
    id: number
    count: number
  }>
  id: number
  chat_link: string
}

interface API_Recipes_Entry_Next extends API_Recipes_Entry {
  multipleRecipeCount: number
  daily_purchase_cap?: number
  weekly_purchase_cap?: number
}

type BasicItemComponent = {
    id: number;
    type: 'Item';
    quantity: number;
};
type BasicCurrencyComponent = {
    id: number;
    type: 'Currency';
    quantity: number;
};
type BasicGuildUpgradeComponent = {
    id: number;
    type: 'GuildUpgrade';
    quantity: number;
};
type Prerequisites = Array<{
    type: 'Recipe';
    id: number;
}>;
interface NestedRecipe extends TransformedRecipe {
    components: Array<NestedRecipe | BasicItemComponent | BasicCurrencyComponent | BasicGuildUpgradeComponent>;
}
interface TransformedRecipe {
    id: number;
    type: 'Recipe';
    quantity: number;
    output: number;
    min_rating: number | null;
    disciplines: Array<string>;
    upgrade_id?: number;
    output_range?: string;
    achievement_id?: number;
    merchant?: {
        name: string;
        locations: Array<string>;
    };
    prerequisites: Prerequisites;
    multipleRecipeCount: number;
    daily_purchase_cap?: number;
    weekly_purchase_cap?: number;
}
declare function nestRecipes(apiRecipes: Array<API_Recipes_Entry_Next>, decorationMap?: Record<string, number>): Array<NestedRecipe>;

export { BasicCurrencyComponent, BasicGuildUpgradeComponent, BasicItemComponent, NestedRecipe, Prerequisites, nestRecipes };
