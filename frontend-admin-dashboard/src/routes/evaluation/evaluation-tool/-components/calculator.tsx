'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useTranslation } from 'react-i18next';

export default function Calculator({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('evaluationCalculator');
    const [display, setDisplay] = useState('0');
    const [firstOperand, setFirstOperand] = useState<number | null>(null);
    const [operator, setOperator] = useState<string | null>(null);
    const [waitingForSecondOperand, setWaitingForSecondOperand] = useState(false);

    const clearDisplay = () => {
        setDisplay('0');
        setFirstOperand(null);
        setOperator(null);
        setWaitingForSecondOperand(false);
    };

    const inputDigit = (digit: string) => {
        // If we just completed an equals operation (operator is null), reset the display
        if (operator === null && firstOperand !== null) {
            setDisplay(digit);
            setFirstOperand(null);
            return;
        }

        if (waitingForSecondOperand) {
            setDisplay(digit);
            setWaitingForSecondOperand(false);
        } else {
            setDisplay(display === '0' ? digit : display + digit);
        }
    };

    const inputDecimal = () => {
        if (waitingForSecondOperand) {
            setDisplay('0.');
            setWaitingForSecondOperand(false);
            return;
        }

        if (!display.includes('.')) {
            setDisplay(display + '.');
        }
    };

    const handleOperator = (nextOperator: string) => {
        const inputValue = parseFloat(display);

        if (firstOperand === null) {
            setFirstOperand(inputValue);
        } else if (operator) {
            const result = performCalculation();
            setDisplay(String(result));
            setFirstOperand(result);
        }

        setWaitingForSecondOperand(true);
        setOperator(nextOperator);
    };

    const performCalculation = () => {
        if (firstOperand === null || operator === null) return parseFloat(display);

        const inputValue = parseFloat(display);
        let result = 0;

        switch (operator) {
            case '+':
                result = firstOperand + inputValue;
                break;
            case '-':
                result = firstOperand - inputValue;
                break;
            case '×':
                result = firstOperand * inputValue;
                break;
            case '÷':
                result = firstOperand / inputValue;
                break;
            case '=':
                result = inputValue;
                break;
        }

        return result;
    };

    const calculate = () => {
        if (firstOperand === null || operator === null) return;

        const result = performCalculation();
        setDisplay(String(result));
        setFirstOperand(result);
        setOperator(null);
        setWaitingForSecondOperand(false);
    };

    const toggleSign = () => {
        const newValue = parseFloat(display) * -1;
        setDisplay(String(newValue));
    };

    const calculatePercentage = () => {
        const currentValue = parseFloat(display);
        const newValue = currentValue / 100;
        setDisplay(String(newValue));
    };

    return (
        <MyDialog heading={t('calculator')} open={open} onOpenChange={onOpenChange}>
            <div className="mx-auto flex size-3/4 flex-col overflow-hidden rounded-2xl bg-slate-50">
                {/* Display */}
                <div className="relative flex h-1/4 items-end justify-end bg-slate-100 p-6 text-black">
                    {operator && (
                        <div className="absolute left-2 top-2 text-xl text-gray-500">
                            {operator}
                        </div>
                    )}
                    <div className="truncate text-5xl font-light">{display}</div>
                </div>

                {/* Keypad */}
                <div className="grid h-3/4 grid-cols-4 gap-2 p-3">
                    {/* Row 1 */}
                    <Button
                        onClick={clearDisplay}
                        className="bg-gray-500 text-black hover:bg-gray-400"
                    >
                        {firstOperand !== null && display !== '0' ? 'C' : 'AC'}
                    </Button>
                    <Button
                        onClick={toggleSign}
                        className="bg-gray-500 text-black hover:bg-gray-400"
                    >
                        +/−
                    </Button>
                    <Button
                        onClick={calculatePercentage}
                        className="bg-gray-500 text-black hover:bg-gray-400"
                    >
                        %
                    </Button>
                    <Button
                        onClick={() => handleOperator('÷')}
                        className={`bg-orange-500 text-white hover:bg-orange-400 ${
                            operator === '÷' && waitingForSecondOperand
                                ? 'bg-white text-orange-500'
                                : ''
                        }`}
                    >
                        ÷
                    </Button>

                    {/* Row 2 */}
                    <Button
                        onClick={() => inputDigit('7')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        7
                    </Button>
                    <Button
                        onClick={() => inputDigit('8')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        8
                    </Button>
                    <Button
                        onClick={() => inputDigit('9')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        9
                    </Button>
                    <Button
                        onClick={() => handleOperator('×')}
                        className={`bg-orange-500 text-white hover:bg-orange-400 ${
                            operator === '×' && waitingForSecondOperand
                                ? 'bg-white text-orange-500'
                                : ''
                        }`}
                    >
                        ×
                    </Button>

                    {/* Row 3 */}
                    <Button
                        onClick={() => inputDigit('4')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        4
                    </Button>
                    <Button
                        onClick={() => inputDigit('5')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        5
                    </Button>
                    <Button
                        onClick={() => inputDigit('6')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        6
                    </Button>
                    <Button
                        onClick={() => handleOperator('-')}
                        className={`bg-orange-500 text-white hover:bg-orange-400 ${
                            operator === '-' && waitingForSecondOperand
                                ? 'bg-white text-orange-500'
                                : ''
                        }`}
                    >
                        −
                    </Button>

                    {/* Row 4 */}
                    <Button
                        onClick={() => inputDigit('1')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        1
                    </Button>
                    <Button
                        onClick={() => inputDigit('2')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        2
                    </Button>
                    <Button
                        onClick={() => inputDigit('3')}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        3
                    </Button>
                    <Button
                        onClick={() => handleOperator('+')}
                        className={`bg-orange-500 text-white hover:bg-orange-400 ${
                            operator === '+' && waitingForSecondOperand
                                ? 'bg-white text-orange-500'
                                : ''
                        }`}
                    >
                        +
                    </Button>

                    {/* Row 5 */}
                    <Button
                        onClick={() => inputDigit('0')}
                        className="col-span-2 bg-gray-700 text-white hover:bg-gray-600"
                    >
                        0
                    </Button>
                    <Button
                        onClick={inputDecimal}
                        className="bg-gray-700 text-white hover:bg-gray-600"
                    >
                        .
                    </Button>
                    <Button
                        onClick={calculate}
                        className="bg-orange-500 text-white hover:bg-orange-400"
                    >
                        =
                    </Button>
                </div>
            </div>
        </MyDialog>
    );
}
