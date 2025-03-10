import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  BelongsToManyAddAssociationsMixin,
  HasManyGetAssociationsMixin,
} from 'sequelize';
import { User } from './user.ts';
import { Status, UserSurvey } from './userSurvey.ts';
import { Question } from './question.ts';
import { Category } from './category.ts';

export class Survey extends Model<
  InferAttributes<Survey>,
  InferCreationAttributes<Survey>
> {
  declare id: CreationOptional<number>;
  declare title: string;

  declare addUser: BelongsToManyAddAssociationsMixin<User, number>;
  declare addCategories: BelongsToManyAddAssociationsMixin<Category, number>;

  static associate(models: any) {
    this.belongsToMany(models.User, {
      through: models.UserSurvey,
      foreignKey: 'surveyId',
    });

    this.hasMany(models.UserSurvey, { foreignKey: 'surveyId' });

    this.belongsToMany(models.Category, {
      through: 'SurveyCategories',
      foreignKey: 'surveyId',
      timestamps: false,
    });
  }

  static async createNewSurvey({
    title,
    userId,
    questions,
    categories,
  }: {
    title: string;
    userId: string;
    questions: string[];
    categories: string[];
  }) {
    return Survey.sequelize!.transaction(async (t) => {
      const survey = await Survey.create({ title }, { transaction: t });
      const userInstance = await User.findByPk(+userId);

      if (!userInstance) {
        throw new Error('Survey must be associated with a user');
      }

      const userSurvey = await UserSurvey.create(
        {
          userId: userInstance.id,
          surveyId: survey.id,
          status: Status.initial,
        },
        { transaction: t }
      );

      let createdQuestions: Question[] = [];

      if (questions.length > 0) {
        createdQuestions = await Question.bulkCreate(
          questions.map((question) => ({
            question,
            userSurveyId: userSurvey.id,
          })),
          { transaction: t }
        );
      }

      const categoryInstances = await Category.findAll({
        where: {
          name: categories,
        },
      });

      if (categoryInstances.length !== categories.length) {
        throw new Error('Some categories do not exist');
      }

      await survey.addCategories(categoryInstances, { transaction: t });

      return {
        title: survey.title,
        userSurveyId: userSurvey.id,
        status: userSurvey.status,
        questions: createdQuestions.map(({ id, question }) => ({
          id,
          question,
        })),
        categories: categoryInstances.map(({ id, name }) => ({
          id,
          name,
        })),
      };
    });
  }

  static async updateSurveyAnswers({
    userSurveyId,
    answers,
  }: {
    userSurveyId: number;
    answers: { questionId: number; answer: string }[];
  }) {
    return Survey.sequelize!.transaction(async (t) => {
      // Fetch the UserSurvey instance
      const userSurvey = await UserSurvey.findByPk(userSurveyId, {
        transaction: t,
      });

      if (!userSurvey) {
        throw new Error('UserSurvey not found');
      }

      // ✅ Now get associated questions using Sequelize association
      const questions = await Question.findAll({
        where: { userSurveyId },
        transaction: t,
      });

      if (questions.length !== answers.length) {
        throw new Error('All questions must have an answer');
      }

      // Ensure all answers are provided and non-empty
      const answerMap = new Map(
        answers.map(({ questionId, answer }) => [questionId, answer.trim()])
      );

      for (const question of questions) {
        if (!answerMap.has(question.id) || answerMap.get(question.id) === '') {
          throw new Error(
            `Answer for question ID ${question.id} is missing or empty`
          );
        }
      }

      // Update answers
      await Promise.all(
        questions.map((question) =>
          question.update(
            { answer: answerMap.get(question.id) },
            { transaction: t }
          )
        )
      );

      return {
        userSurveyId,
        status: 'completed',
        updatedAnswers: answers,
      };
    });
  }
}

export default (sequelize: Sequelize) => {
  Survey.init(
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      title: { type: DataTypes.STRING, allowNull: false },
    },
    {
      sequelize,
      modelName: 'Survey',
      tableName: 'Surveys',
    }
  );
  return Survey;
};
