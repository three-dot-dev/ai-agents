export declare enum CallbackInfo {
    VELIXG = 3,
    VELIXV = 4,
    CODEM = 5
}
export declare function textInfoWelcome(username: string): string;
export declare const textInfo: {
    commandVelixGen: string;
    commandVelixVision: string;
    commandVelixCodeMorph: string;
};
export declare const keyboardMarkup: {
    start: ({
        text: string;
        callback_data: string;
    }[] | {
        text: string;
        url: string;
    }[])[];
};
