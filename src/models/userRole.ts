import { Model, DataTypes, Sequelize } from 'sequelize';

export class UserRole extends Model {
  declare userId: number;
  declare roleId: number;

  static initModel(sequelize: Sequelize) {
    UserRole.init(
      {
        userId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'Users', key: 'id' },
        },
        roleId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'Roles', key: 'id' },
        },
      },
      {
        sequelize,
        modelName: 'UserRole',
        tableName: 'UserRoles',
        timestamps: true,
      }
    );
  }
}

export default (sequelize: Sequelize) => {
  UserRole.initModel(sequelize);
  return UserRole;
};
